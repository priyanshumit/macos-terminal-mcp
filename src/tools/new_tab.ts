import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OsascriptError, runJxa } from "../applescript.js";
import { appendAudit } from "../safety/audit.js";
import { isWriteToolsEnabled, writeToolsDisabledMessage } from "../safety/confirm.js";

export const NEW_TAB_SCRIPT = `
var app = Application.currentApplication();
app.includeStandardAdditions = true;
function safe(fn) { try { return fn(); } catch (e) { return null; } }
function snapshotTabs(terminal) {
  // Returns { tty -> windowId } for every tab in every window.
  const out = {};
  const wins = terminal.windows();
  for (let wi = 0; wi < wins.length; wi++) {
    const winId = safe(function () { return wins[wi].id(); });
    const tabs = wins[wi].tabs();
    for (let ti = 0; ti < tabs.length; ti++) {
      const t = safe(function () { return tabs[ti].tty(); });
      if (t) out[t] = winId;
    }
  }
  return out;
}
(function newTab() {
  const terminal = Application("Terminal");
  const systemEvents = Application("System Events");
  terminal.activate();
  // activate() returns before the window server actually makes Terminal frontmost.
  // Without this delay, the Cmd+T keystroke can land on whichever app was
  // frontmost when the call started, opening a new window instead of a new tab.
  delay(0.15);
  const before = snapshotTabs(terminal);
  const wasEmpty = Object.keys(before).length === 0;
  // Cmd+T opens a new tab in the front window; Cmd+N opens a new window when
  // there are none.
  systemEvents.keystroke(wasEmpty ? "n" : "t", { using: "command down" });
  // Poll for the new tab's tty to appear. Each iteration waits 100ms, up to ~2s.
  let newTty = null;
  let newWindowId = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    delay(0.1);
    const after = snapshotTabs(terminal);
    const keys = Object.keys(after);
    for (let i = 0; i < keys.length; i++) {
      if (!(keys[i] in before)) {
        newTty = keys[i];
        newWindowId = after[keys[i]];
        break;
      }
    }
    if (newTty !== null) break;
  }
  if (newTty === null) {
    throw new Error("terminal_new_tab: no new tab appeared after Cmd+" + (wasEmpty ? "N" : "T") + ". Accessibility permission may be missing — grant via System Settings → Privacy & Security → Accessibility.");
  }
  return JSON.stringify({ tty: newTty, windowId: newWindowId });
})();
`;

export async function newTabHandler(): Promise<CallToolResult> {
  if (!isWriteToolsEnabled()) {
    return {
      content: [{ type: "text", text: writeToolsDisabledMessage("terminal_new_tab") }],
      isError: true,
    };
  }
  try {
    const json = await runJxa(NEW_TAB_SCRIPT);
    await appendAudit({ tool: "terminal_new_tab", outcome: "success" });
    return { content: [{ type: "text", text: json }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof OsascriptError && /not authorized/i.test(err.stderr)
        ? "\nAutomation permission missing — System Settings → Privacy & Security → Automation."
        : "";
    await appendAudit({
      tool: "terminal_new_tab",
      outcome: "error",
      errorMessage: message,
    });
    return {
      content: [{ type: "text", text: `terminal_new_tab failed: ${message}${hint}` }],
      isError: true,
    };
  }
}

export function register(server: McpServer): void {
  server.registerTool(
    "terminal_new_tab",
    {
      description:
        "Open a new empty tab in Terminal.app (in the frontmost window, or a new window if none are open). Returns {tty, windowId} for the new tab. Use the returned tty in subsequent terminal_read / terminal_execute calls. NOTE: this tool does NOT execute any command in the new tab — to run a command, call terminal_execute against the returned tty. Requires WRITE_TOOLS_ENABLED=1 but does NOT pop a confirmation dialog (low blast radius — the user can close an unwanted tab). Briefly steals focus to Terminal.app to deliver a Cmd+T keystroke, so also requires Accessibility permission (System Settings → Privacy & Security → Accessibility).",
    },
    newTabHandler,
  );
}
