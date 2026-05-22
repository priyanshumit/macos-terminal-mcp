import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { OsascriptError, runJxa } from "../applescript.js";

export function buildReadScript(tty: string): string {
  return `
function safe(fn) {
  try { return fn(); } catch (e) { return null; }
}
(function readTerminal(targetTty) {
  const terminal = Application("Terminal");
  const wins = terminal.windows();
  for (let wi = 0; wi < wins.length; wi++) {
    const w = wins[wi];
    const tabs = w.tabs();
    for (let ti = 0; ti < tabs.length; ti++) {
      const t = tabs[ti];
      if (safe(function () { return t.tty(); }) === targetTty) {
        return safe(function () { return t.contents(); }) || "";
      }
    }
  }
  throw new Error("No Terminal.app tab found with tty " + targetTty);
})(${JSON.stringify(tty)});
`;
}

export interface ReadInput {
  tty: string;
  lines?: number;
}

export async function readHandler({ tty, lines }: ReadInput): Promise<CallToolResult> {
  try {
    let text = await runJxa(buildReadScript(tty));
    if (lines !== undefined) {
      const split = text.split("\n");
      text = split.slice(-lines).join("\n");
    }
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof OsascriptError && /not authorized/i.test(err.stderr)
        ? "\n\nAutomation permission missing — System Settings → Privacy & Security → Automation."
        : "";
    return {
      content: [{ type: "text", text: `terminal_read failed: ${message}${hint}` }],
      isError: true,
    };
  }
}

export function register(server: McpServer): void {
  server.registerTool(
    "terminal_read",
    {
      description:
        'Read the full contents (visible buffer + scrollback) of a specific Terminal.app tab identified by its tty (e.g. "/dev/ttys003"). Call terminal_list first to discover tty values. Optional `lines` returns only the last N lines.',
      inputSchema: {
        tty: z
          .string()
          .regex(/^\/dev\/ttys[0-9]+$/)
          .describe('The tty path identifying the target tab, e.g. "/dev/ttys003"'),
        lines: z
          .number()
          .int()
          .positive()
          .max(20000)
          .optional()
          .describe("If provided, return only the last N lines of the buffer."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    readHandler,
  );
}
