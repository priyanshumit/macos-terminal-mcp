import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  confirmWithUser,
  isWriteToolsEnabled,
  writeToolsDisabledMessage,
} from "../safety/confirm.js";
import {
  loadSafetyConfig,
  type PatternEntry,
  saveSafetyConfig,
  type SafetyLevel,
} from "../safety/patterns.js";

const LEVEL_VALUES = ["safe", "requires_approval", "forbidden"] as const;

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function asTextResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

function describeLevel(level: SafetyLevel): string {
  switch (level) {
    case "safe":
      return "safe (auto-run, no confirmation)";
    case "requires_approval":
      return "requires_approval (dialog confirm)";
    case "forbidden":
      return "forbidden (refused outright)";
  }
}

function registerList(server: McpServer): void {
  server.registerTool(
    "safety_list",
    {
      description:
        "List the current safety policy patterns. Each entry has {pattern, level, description?}. Levels: safe (auto-run), requires_approval (confirm dialog), forbidden (refused outright). Read-only — does not require WRITE_TOOLS_ENABLED.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (): Promise<CallToolResult> => {
      const config = await loadSafetyConfig();
      return asTextResult(JSON.stringify(config.patterns, null, 2));
    },
  );
}

function registerAdd(server: McpServer): void {
  server.registerTool(
    "safety_add",
    {
      description:
        "Add a new pattern to the safety policy. The model proposes a regex + level + (optional) description; the user is shown a confirmation dialog and decides whether to persist it. Persisted to ~/.config/macos-terminal-mcp/safety.json. Requires WRITE_TOOLS_ENABLED=1.",
      inputSchema: {
        pattern: z
          .string()
          .min(1)
          .max(500)
          .describe("Regex pattern (JavaScript syntax) to match against commands"),
        level: z
          .enum(LEVEL_VALUES)
          .describe("Safety level: safe, requires_approval, or forbidden"),
        description: z
          .string()
          .max(500)
          .optional()
          .describe("Human-readable note about why this pattern exists"),
      },
    },
    async ({ pattern, level, description }): Promise<CallToolResult> => {
      if (!isWriteToolsEnabled()) {
        return asTextResult(writeToolsDisabledMessage("safety_add"), true);
      }
      if (!isValidRegex(pattern)) {
        return asTextResult(`Refused: "${pattern}" is not a valid regex.`, true);
      }

      const config = await loadSafetyConfig();
      const existing = config.patterns.find((p) => p.pattern === pattern);
      if (existing) {
        return asTextResult(
          `Pattern already exists with level "${existing.level}". Use safety_set_level to change it.`,
          true,
        );
      }

      const descLine = description ? `\nDescription: ${description}` : "";
      const allowed = await confirmWithUser({
        title: "macos-terminal-mcp · safety_add",
        message:
          `Add safety pattern?\n\n` +
          `Pattern: ${pattern}\n` +
          `Level:   ${describeLevel(level)}` +
          descLine,
      });
      if (!allowed) {
        return asTextResult("User denied the safety policy change.", true);
      }

      const newEntry: PatternEntry = { pattern, level, ...(description ? { description } : {}) };
      const updated = { patterns: [...config.patterns, newEntry] };
      await saveSafetyConfig(updated);
      return asTextResult(
        `Added pattern "${pattern}" with level ${level}. ${updated.patterns.length} patterns total.`,
      );
    },
  );
}

function registerRemove(server: McpServer): void {
  server.registerTool(
    "safety_remove",
    {
      description:
        "Remove a safety pattern by its exact regex string. Triggers a confirmation dialog; if the pattern is currently forbidden, the dialog displays a prominent warning since removal weakens safety. Requires WRITE_TOOLS_ENABLED=1.",
      inputSchema: {
        pattern: z
          .string()
          .min(1)
          .describe("The exact pattern string to remove. Use safety_list to look up patterns."),
      },
    },
    async ({ pattern }): Promise<CallToolResult> => {
      if (!isWriteToolsEnabled()) {
        return asTextResult(writeToolsDisabledMessage("safety_remove"), true);
      }

      const config = await loadSafetyConfig();
      const existing = config.patterns.find((p) => p.pattern === pattern);
      if (!existing) {
        return asTextResult(`No pattern found with value "${pattern}".`, true);
      }

      const warning =
        existing.level === "forbidden"
          ? "⚠ WARNING: this pattern is currently FORBIDDEN. Removing it weakens safety.\n\n"
          : "";
      const descLine = existing.description ? `\nDescription: ${existing.description}` : "";

      const allowed = await confirmWithUser({
        title: "macos-terminal-mcp · safety_remove",
        message:
          `${warning}Remove safety pattern?\n\n` +
          `Pattern: ${pattern}\n` +
          `Current level: ${describeLevel(existing.level)}` +
          descLine,
      });
      if (!allowed) {
        return asTextResult("User denied the safety policy change.", true);
      }

      const updated = {
        patterns: config.patterns.filter((p) => p.pattern !== pattern),
      };
      await saveSafetyConfig(updated);
      return asTextResult(
        `Removed pattern "${pattern}". ${updated.patterns.length} patterns remain.`,
      );
    },
  );
}

function registerSetLevel(server: McpServer): void {
  server.registerTool(
    "safety_set_level",
    {
      description:
        "Change the safety level of an existing pattern. Triggers a confirmation dialog. If the change is a downgrade from forbidden, the dialog displays a prominent warning. Requires WRITE_TOOLS_ENABLED=1.",
      inputSchema: {
        pattern: z.string().min(1).describe("The exact pattern string"),
        level: z
          .enum(LEVEL_VALUES)
          .describe("New safety level: safe, requires_approval, or forbidden"),
      },
    },
    async ({ pattern, level }): Promise<CallToolResult> => {
      if (!isWriteToolsEnabled()) {
        return asTextResult(writeToolsDisabledMessage("safety_set_level"), true);
      }

      const config = await loadSafetyConfig();
      const existing = config.patterns.find((p) => p.pattern === pattern);
      if (!existing) {
        return asTextResult(`No pattern found with value "${pattern}".`, true);
      }
      if (existing.level === level) {
        return asTextResult(`Pattern "${pattern}" is already at level ${level}. No change.`);
      }

      const downgrading = existing.level === "forbidden" && level !== "forbidden";
      const warning = downgrading
        ? "⚠ WARNING: downgrading from FORBIDDEN. This pattern will no longer be refused outright.\n\n"
        : "";

      const allowed = await confirmWithUser({
        title: "macos-terminal-mcp · safety_set_level",
        message:
          `${warning}Change pattern level?\n\n` +
          `Pattern: ${pattern}\n` +
          `From: ${describeLevel(existing.level)}\n` +
          `To:   ${describeLevel(level)}`,
      });
      if (!allowed) {
        return asTextResult("User denied the safety policy change.", true);
      }

      const updated = {
        patterns: config.patterns.map((p) =>
          p.pattern === pattern ? { ...p, level } : p,
        ),
      };
      await saveSafetyConfig(updated);
      return asTextResult(
        `Changed "${pattern}" from ${existing.level} to ${level}.`,
      );
    },
  );
}

export function register(server: McpServer): void {
  registerList(server);
  registerAdd(server);
  registerRemove(server);
  registerSetLevel(server);
}
