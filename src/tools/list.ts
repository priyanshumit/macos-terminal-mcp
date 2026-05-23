import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OsascriptError, runJxa } from "../applescript.js";

const LIST_SCRIPT = `
function safe(fn) {
  try { return fn(); } catch (e) { return null; }
}
(function listTerminals() {
  const terminal = Application("Terminal");
  const result = [];
  const wins = terminal.windows();
  for (let wi = 0; wi < wins.length; wi++) {
    const w = wins[wi];
    // Defensive: during in-progress window-close operations, w.tabs() can
    // briefly return null instead of an empty array, which would crash this
    // script. Treat null as no-tabs and move on.
    const tabs = safe(function () { return w.tabs(); }) || [];
    for (let ti = 0; ti < tabs.length; ti++) {
      const t = tabs[ti];
      result.push({
        windowId: safe(function () { return w.id(); }),
        windowName: safe(function () { return w.name(); }) || "",
        tabIndex: ti + 1,
        tty: safe(function () { return t.tty(); }) || "",
        title: safe(function () { return t.customTitle(); }) || safe(function () { return t.title(); }) || "",
        busy: safe(function () { return t.busy(); }) || false,
        selected: safe(function () { return t.selected(); }) || false,
        processes: safe(function () { return t.processes(); }) || [],
      });
    }
  }
  return JSON.stringify(result);
})();
`;

export async function listHandler(): Promise<CallToolResult> {
  try {
    const json = await runJxa(LIST_SCRIPT);
    return { content: [{ type: "text", text: json }] };
  } catch (err) {
    const hint =
      err instanceof OsascriptError && /not authorized/i.test(err.stderr)
        ? "\n\nThis usually means Automation permission has not been granted. Open System Settings → Privacy & Security → Automation and allow the MCP server's host process to control Terminal.app."
        : "";
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `terminal_list failed: ${message}${hint}` }],
      isError: true,
    };
  }
}

export function register(server: McpServer): void {
  server.registerTool(
    "terminal_list",
    {
      description:
        'List every open Terminal.app window and tab with metadata. Returns a JSON array where each entry has: windowId, windowName, tabIndex, tty, title, busy (is a command running), selected (is the active tab), processes (foreground process names). Use the `tty` value (e.g. "/dev/ttys003") as the stable identifier when calling terminal_read.',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    listHandler,
  );
}
