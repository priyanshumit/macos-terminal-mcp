import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OsascriptError, runJxa } from "../applescript.js";
import { appendAudit } from "../safety/audit.js";
import { isWriteToolsEnabled, writeToolsDisabledMessage } from "../safety/confirm.js";

export const NEW_TAB_SCRIPT = `
function safe(fn) { try { return fn(); } catch (e) { return null; } }
(function newTab() {
  const terminal = Application("Terminal");
  terminal.activate();
  const wins = terminal.windows();
  // do script with empty command + no "in" → new window. With "in: front
  // window" → new tab in that window. Prefer a new tab in the front window
  // when one exists, otherwise let it create a new window.
  let newTab;
  if (wins.length > 0) {
    newTab = terminal.doScript("", { in: wins[0] });
  } else {
    newTab = terminal.doScript("");
  }
  const tty = safe(function () { return newTab.tty(); }) || "";
  let windowId = null;
  try {
    const after = terminal.windows();
    for (let i = 0; i < after.length; i++) {
      const ts = after[i].tabs();
      for (let j = 0; j < ts.length; j++) {
        if (safe(function () { return ts[j].tty(); }) === tty) {
          windowId = safe(function () { return after[i].id(); });
          break;
        }
      }
      if (windowId !== null) break;
    }
  } catch (e) { /* best-effort */ }
  return JSON.stringify({ tty, windowId });
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
        "Open a new empty tab in Terminal.app (in the frontmost window, or a new window if none are open). Returns {tty, windowId} for the new tab. Use the returned tty in subsequent terminal_read / terminal_execute calls. NOTE: this tool does NOT execute any command in the new tab — to run a command, call terminal_execute against the returned tty. Requires WRITE_TOOLS_ENABLED=1 but does NOT pop a confirmation dialog (low blast radius — the user can close an unwanted tab).",
    },
    newTabHandler,
  );
}
