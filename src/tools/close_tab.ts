import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { OsascriptError, runJxa } from "../applescript.js";
import { appendAudit } from "../safety/audit.js";
import { isWriteToolsEnabled, writeToolsDisabledMessage } from "../safety/confirm.js";

export function buildCloseTabScript(tty: string, force: boolean): string {
  return `
var app = Application.currentApplication();
app.includeStandardAdditions = true;
function safe(fn) { try { return fn(); } catch (e) { return null; } }
(function closeTab(targetTty, force) {
  const terminal = Application("Terminal");
  const wins = terminal.windows();
  for (let wi = 0; wi < wins.length; wi++) {
    const w = wins[wi];
    const tabs = safe(function () { return w.tabs(); }) || [];
    for (let ti = 0; ti < tabs.length; ti++) {
      const t = tabs[ti];
      if (safe(function () { return t.tty(); }) === targetTty) {
        const busy = safe(function () { return t.busy(); }) === true;
        if (busy && !force) {
          return JSON.stringify({ status: "busy", tty: targetTty });
        }
        // Terminal.app's AppleScript dictionary does NOT expose "close" on
        // tab objects. We previously called w.close() but that destroys the
        // entire enclosing physical window, killing sibling tabs (verified
        // live: a 3-tab window lost two tabs when closing one). The reliable
        // way to close ONE specific tab mirrors the terminal_clear pattern:
        // activate Terminal, make the target tab the key tab via frontmost +
        // selected, settle, then send Cmd+W via System Events. Cmd+W on a
        // selected tab closes only that tab.
        terminal.activate();
        try { Application("System Events").applicationProcesses["Terminal"].frontmost = true; } catch (e) { /* best-effort */ }
        try { w.frontmost = true; } catch (e) { /* best-effort */ }
        try { t.selected = true; } catch (e) { /* best-effort */ }
        delay(0.3);
        Application("System Events").keystroke("w", { using: "command down" });
        return JSON.stringify({ status: "closed", tty: targetTty, killedRunningCommand: busy });
      }
    }
  }
  return JSON.stringify({ status: "missing", tty: targetTty });
})(${JSON.stringify(tty)}, ${JSON.stringify(force)});
`;
}

interface CloseResult {
  status: "closed" | "busy" | "missing";
  tty: string;
  killedRunningCommand?: boolean;
}

export interface CloseTabInput {
  tty: string;
  /** If true, close the tab even if it has a running foreground command (the command is killed). Default: false. */
  force?: boolean;
}

export async function closeTabHandler({
  tty,
  force = false,
}: CloseTabInput): Promise<CallToolResult> {
  if (!isWriteToolsEnabled()) {
    return {
      content: [{ type: "text", text: writeToolsDisabledMessage("terminal_close_tab") }],
      isError: true,
    };
  }

  let raw: string;
  try {
    raw = await runJxa(buildCloseTabScript(tty, force));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof OsascriptError && /not authorized/i.test(err.stderr)
        ? "\nAutomation permission missing — System Settings → Privacy & Security → Automation."
        : "";
    await appendAudit({
      tool: "terminal_close_tab",
      outcome: "error",
      tty,
      errorMessage: message,
    });
    return {
      content: [{ type: "text", text: `terminal_close_tab failed: ${message}${hint}` }],
      isError: true,
    };
  }

  let result: CloseResult;
  try {
    result = JSON.parse(raw) as CloseResult;
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `terminal_close_tab: unexpected JXA response: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  if (result.status === "missing") {
    return {
      content: [{ type: "text", text: `No Terminal.app tab found with tty ${tty}.` }],
      isError: true,
    };
  }

  if (result.status === "busy") {
    await appendAudit({
      tool: "terminal_close_tab",
      outcome: "refused",
      tty,
      details: { reason: "target tab is busy" },
    });
    return {
      content: [
        {
          type: "text",
          text:
            `Refused: target tab ${tty} is busy with a running command. Closing it would kill the process. ` +
            `Pass force=true to close anyway, or wait for the command to finish (see terminal_wait_for_idle).`,
        },
      ],
      isError: true,
    };
  }

  await appendAudit({
    tool: "terminal_close_tab",
    outcome: "success",
    tty,
    ...(result.killedRunningCommand
      ? { details: { killedRunningCommand: true, force: true } }
      : {}),
  });
  return {
    content: [
      {
        type: "text",
        text: result.killedRunningCommand
          ? `Closed ${tty} [force=true, killed running command].`
          : `Closed ${tty}.`,
      },
    ],
  };
}

export function register(server: McpServer): void {
  server.registerTool(
    "terminal_close_tab",
    {
      description:
        "Close a specific Terminal.app tab by tty. Useful for cleaning up scratch tabs spawned via terminal_new_tab. If the tab has a running foreground command, the call refuses by default — pass force=true to close anyway (the running command is killed). Requires WRITE_TOOLS_ENABLED=1 but no confirmation dialog (low blast radius for idle tabs; force=true scenarios are deliberate).",
      inputSchema: {
        tty: z
          .string()
          .regex(/^\/dev\/ttys[0-9]+$/)
          .describe('Target tab tty, e.g. "/dev/ttys003"'),
        force: z
          .boolean()
          .optional()
          .describe(
            "If true, close even when a foreground command is running (killing it). Default: false.",
          ),
      },
    },
    closeTabHandler,
  );
}
