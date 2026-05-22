import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { OsascriptError, runJxa } from "../applescript.js";
import {
  confirmWithUser,
  isWriteToolsEnabled,
  writeToolsDisabledMessage,
} from "../safety/confirm.js";

export function buildClearScript(tty: string): string {
  return `
function safe(fn) { try { return fn(); } catch (e) { return null; } }
var app = Application.currentApplication();
app.includeStandardAdditions = true;
(function clearTab(targetTty) {
  const terminal = Application("Terminal");
  const wins = terminal.windows();
  for (let wi = 0; wi < wins.length; wi++) {
    const w = wins[wi];
    const tabs = w.tabs();
    for (let ti = 0; ti < tabs.length; ti++) {
      const t = tabs[ti];
      if (safe(function () { return t.tty(); }) === targetTty) {
        terminal.activate();
        try { w.frontmost = true; } catch (e) {}
        try { t.selected = true; } catch (e) {}
        delay(0.2);
        Application("System Events").keystroke("k", { using: "command down" });
        return "OK";
      }
    }
  }
  throw new Error("No Terminal.app tab found with tty " + targetTty);
})(${JSON.stringify(tty)});
`;
}

export interface ClearInput {
  tty: string;
}

export async function clearHandler({ tty }: ClearInput): Promise<CallToolResult> {
  if (!isWriteToolsEnabled()) {
    return {
      content: [{ type: "text", text: writeToolsDisabledMessage("terminal_clear") }],
      isError: true,
    };
  }

  let allowed: boolean;
  try {
    allowed = await confirmWithUser({
      title: "macos-terminal-mcp · terminal_clear",
      message: `Clear scrollback of ${tty}?\n\nThis briefly switches focus to Terminal.app to deliver Cmd+K.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Confirmation dialog failed: ${message}` }],
      isError: true,
    };
  }

  if (!allowed) {
    return { content: [{ type: "text", text: "User denied the clear." }], isError: true };
  }

  try {
    await runJxa(buildClearScript(tty));
    return { content: [{ type: "text", text: `Cleared scrollback of ${tty}.` }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof OsascriptError && /not authorized/i.test(err.stderr)
        ? "\nMissing Automation OR Accessibility permission. Both are required for keystroke simulation."
        : "";
    return {
      content: [{ type: "text", text: `terminal_clear failed: ${message}${hint}` }],
      isError: true,
    };
  }
}

export function register(server: McpServer): void {
  server.registerTool(
    "terminal_clear",
    {
      description:
        'Clear the buffer AND scrollback of a specific Terminal.app tab by simulating Cmd+K (Edit → Clear Scrollback). Side effect: briefly steals focus to Terminal.app to deliver the keystroke; the user may need to switch back to their previous app. Requires WRITE_TOOLS_ENABLED=1 and triggers a confirmation dialog.',
      inputSchema: {
        tty: z
          .string()
          .regex(/^\/dev\/ttys[0-9]+$/)
          .describe('Target tab tty, e.g. "/dev/ttys003"'),
      },
    },
    clearHandler,
  );
}
