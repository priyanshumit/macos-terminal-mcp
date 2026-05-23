import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { appendAudit } from "../safety/audit.js";
import {
  confirmWithUser,
  isWriteToolsEnabled,
  sanitizeAiText,
  writeToolsDisabledMessage,
} from "../safety/confirm.js";
import { getPending, listPending, resolvePending } from "../safety/queue.js";

function asTextResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… [${s.length - max} chars elided]` : s;
}

function registerList(server: McpServer): void {
  server.registerTool(
    "pending_list",
    {
      description:
        "List commands currently awaiting approval. Each entry has {id, tty, command, matchedPattern?, matchedDescription?, createdAt, expiresAt, ageMs}. Entries auto-expire 10 minutes after enqueue. Read-only — does not require WRITE_TOOLS_ENABLED.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (): Promise<CallToolResult> => {
      const snapshot = listPending();
      return asTextResult(JSON.stringify(snapshot, null, 2));
    },
  );
}

function registerApprove(server: McpServer): void {
  server.registerTool(
    "pending_approve",
    {
      description:
        "Approve a queued command by its id. Triggers a native confirmation dialog showing the queued command details before resolving. Requires WRITE_TOOLS_ENABLED=1. Calling this races with the native dialog originally raised by terminal_execute — whichever resolves first wins.",
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe("Pending queue entry id (from pending_list or terminal_execute response)"),
      },
    },
    async ({ id }): Promise<CallToolResult> => {
      if (!isWriteToolsEnabled()) {
        return asTextResult(writeToolsDisabledMessage("pending_approve"), true);
      }
      const entry = getPending(id);
      if (!entry) {
        return asTextResult(
          `No pending entry with id ${id} (expired, already resolved, or never existed).`,
          true,
        );
      }

      const descPart = entry.matchedDescription
        ? `\nMatched: ${sanitizeAiText(entry.matchedPattern ?? "")} (${sanitizeAiText(entry.matchedDescription)})`
        : entry.matchedPattern
          ? `\nMatched pattern: ${sanitizeAiText(entry.matchedPattern)}`
          : "";
      const allowed = await confirmWithUser({
        title: "macos-terminal-mcp · pending_approve",
        message:
          `Approve queued command?\n\n` +
          `Target: ${entry.tty}\n` +
          `Command: ${sanitizeAiText(truncate(entry.command, 800))}${descPart}\n` +
          `Queue id: ${id}`,
      });
      if (!allowed) {
        await appendAudit({
          tool: "pending_approve",
          outcome: "denied",
          tty: entry.tty,
          command: entry.command,
          source: "dialog",
          details: { queueId: id },
        });
        return asTextResult("User denied the approval.", true);
      }
      const ok = resolvePending(id, true, "queue");
      if (!ok) {
        return asTextResult(
          `Entry ${id} was already resolved by another path (likely the original dialog).`,
          true,
        );
      }
      await appendAudit({
        tool: "pending_approve",
        outcome: "success",
        tty: entry.tty,
        command: entry.command,
        source: "queue",
        details: { queueId: id },
      });
      return asTextResult(`Approved ${id}.`);
    },
  );
}

function registerDeny(server: McpServer): void {
  server.registerTool(
    "pending_deny",
    {
      description:
        "Deny a queued command by its id. Triggers a confirmation dialog with the queued command details. Requires WRITE_TOOLS_ENABLED=1.",
      inputSchema: {
        id: z.string().uuid().describe("Pending queue entry id"),
        reason: z
          .string()
          .max(500)
          .optional()
          .describe("Optional human-readable reason for denial"),
      },
    },
    async ({ id, reason }): Promise<CallToolResult> => {
      if (!isWriteToolsEnabled()) {
        return asTextResult(writeToolsDisabledMessage("pending_deny"), true);
      }
      const entry = getPending(id);
      if (!entry) {
        return asTextResult(
          `No pending entry with id ${id} (expired, already resolved, or never existed).`,
          true,
        );
      }

      const reasonPart = reason ? `\n\nReason: ${sanitizeAiText(reason)}` : "";
      const allowed = await confirmWithUser({
        title: "macos-terminal-mcp · pending_deny",
        message:
          `Deny queued command?\n\n` +
          `Target: ${entry.tty}\n` +
          `Command: ${sanitizeAiText(truncate(entry.command, 800))}\n` +
          `Queue id: ${id}${reasonPart}`,
      });
      if (!allowed) {
        return asTextResult("User cancelled the denial.", true);
      }
      const ok = resolvePending(id, false, "queue", reason);
      if (!ok) {
        return asTextResult(`Entry ${id} was already resolved by another path.`, true);
      }
      await appendAudit({
        tool: "pending_deny",
        outcome: "success",
        tty: entry.tty,
        command: entry.command,
        source: "queue",
        details: { queueId: id, ...(reason ? { reason } : {}) },
      });
      return asTextResult(`Denied ${id}${reason ? `: ${reason}` : ""}.`);
    },
  );
}

export function register(server: McpServer): void {
  registerList(server);
  registerApprove(server);
  registerDeny(server);
}
