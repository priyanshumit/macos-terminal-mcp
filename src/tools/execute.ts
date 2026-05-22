import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { OsascriptError, runJxa } from "../applescript.js";
import {
  confirmWithUser,
  isWriteToolsEnabled,
  writeToolsDisabledMessage,
} from "../safety/confirm.js";
import { evaluateCommand, loadSafetyConfig } from "../safety/patterns.js";
import { enqueue, resolvePending } from "../safety/queue.js";

export function buildExecuteScript(tty: string, command: string): string {
  return `
function safe(fn) { try { return fn(); } catch (e) { return null; } }
(function executeInTab(targetTty, command) {
  const terminal = Application("Terminal");
  const wins = terminal.windows();
  for (let wi = 0; wi < wins.length; wi++) {
    const w = wins[wi];
    const tabs = w.tabs();
    for (let ti = 0; ti < tabs.length; ti++) {
      const t = tabs[ti];
      if (safe(function () { return t.tty(); }) === targetTty) {
        terminal.doScript(command, { in: t });
        return "OK";
      }
    }
  }
  throw new Error("No Terminal.app tab found with tty " + targetTty);
})(${JSON.stringify(tty)}, ${JSON.stringify(command)});
`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… [${s.length - max} chars elided]` : s;
}

export interface ExecuteInput {
  tty: string;
  command: string;
}

export async function executeHandler({ tty, command }: ExecuteInput): Promise<CallToolResult> {
  if (!isWriteToolsEnabled()) {
    return {
      content: [{ type: "text", text: writeToolsDisabledMessage("terminal_execute") }],
      isError: true,
    };
  }

  const config = await loadSafetyConfig();
  const verdict = evaluateCommand(command, config);

  if (verdict.level === "forbidden") {
    const descPart = verdict.matchedDescription ? ` (${verdict.matchedDescription})` : "";
    return {
      content: [
        {
          type: "text",
          text:
            `Refused: command matches FORBIDDEN pattern ${verdict.matchedPattern}${descPart}. ` +
            `Forbidden commands cannot be approved through this tool — run them yourself in a terminal if you need to.`,
        },
      ],
      isError: true,
    };
  }

  let resolutionSource: "dialog" | "queue" | "expired" | "auto" = "auto";
  if (verdict.level === "requires_approval") {
    const descPart = verdict.matchedDescription
      ? `\nMatched: ${verdict.matchedPattern} (${verdict.matchedDescription})`
      : verdict.matchedPattern
        ? `\nMatched pattern: ${verdict.matchedPattern}`
        : "\nNo matching pattern — default policy requires approval.";

    const { id, promise } = enqueue({
      tty,
      command,
      matchedPattern: verdict.matchedPattern,
      matchedDescription: verdict.matchedDescription,
    });

    void confirmWithUser({
      title: "macos-terminal-mcp · terminal_execute",
      message: `Run in ${tty}:\n\n${truncate(command, 800)}${descPart}\n\nQueue id: ${id}`,
    }).then(
      (allowed) => resolvePending(id, allowed, "dialog"),
      () => undefined,
    );

    const result = await promise;
    if (!result.approved) {
      const reasonPart = result.reason ? ` (${result.reason})` : "";
      return {
        content: [
          {
            type: "text",
            text: `Command denied via ${result.source}${reasonPart}.`,
          },
        ],
        isError: true,
      };
    }
    resolutionSource = result.source;
  }

  try {
    await runJxa(buildExecuteScript(tty, command));
    const path =
      verdict.level === "safe"
        ? `auto-run (safe pattern: ${verdict.matchedPattern})`
        : `approved via ${resolutionSource}`;
    return {
      content: [
        {
          type: "text",
          text: `Executed in ${tty} [${path}]: ${truncate(command, 200)}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof OsascriptError && /not authorized/i.test(err.stderr)
        ? "\nAutomation permission missing — System Settings → Privacy & Security → Automation."
        : "";
    return {
      content: [{ type: "text", text: `terminal_execute failed: ${message}${hint}` }],
      isError: true,
    };
  }
}

export function register(server: McpServer): void {
  server.registerTool(
    "terminal_execute",
    {
      description:
        'Run a shell command in a specific Terminal.app tab identified by its tty (e.g. "/dev/ttys003"). Behaves as if the command was typed by the user and Enter was pressed — output appears in the tab. Three-tier safety: "safe" patterns auto-run, "requires_approval" patterns trigger a native confirmation dialog, "forbidden" patterns are refused outright. Requires WRITE_TOOLS_ENABLED=1.',
      inputSchema: {
        tty: z
          .string()
          .regex(/^\/dev\/ttys[0-9]+$/)
          .describe('Target tab tty, e.g. "/dev/ttys003"'),
        command: z
          .string()
          .min(1)
          .max(8192)
          .describe("Shell command to run in the target tab"),
      },
    },
    executeHandler,
  );
}
