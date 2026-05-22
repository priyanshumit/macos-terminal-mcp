import { runJxa } from "../applescript.js";

export function isWriteToolsEnabled(): boolean {
  return process.env.WRITE_TOOLS_ENABLED === "1";
}

export interface ConfirmRequest {
  title: string;
  message: string;
  allowLabel?: string;
  denyLabel?: string;
  /** Auto-dismiss the dialog after this many seconds (treated as denial). Default 300 (5 min). */
  timeoutSeconds?: number;
}

const DEFAULT_DIALOG_TIMEOUT_SEC = 300;

export async function confirmWithUser(req: ConfirmRequest): Promise<boolean> {
  const allow = req.allowLabel ?? "Allow";
  const deny = req.denyLabel ?? "Deny";
  const timeoutSec = req.timeoutSeconds ?? DEFAULT_DIALOG_TIMEOUT_SEC;
  const script = `
var app = Application.currentApplication();
app.includeStandardAdditions = true;
(function () {
  try {
    var result = app.displayDialog(
      ${JSON.stringify(req.message)},
      {
        buttons: [${JSON.stringify(deny)}, ${JSON.stringify(allow)}],
        defaultButton: ${JSON.stringify(deny)},
        cancelButton: ${JSON.stringify(deny)},
        withTitle: ${JSON.stringify(req.title)},
        withIcon: "caution",
        givingUpAfter: ${timeoutSec}
      }
    );
    if (result.gaveUp) return "TIMEOUT";
    return result.buttonReturned === ${JSON.stringify(allow)} ? "ALLOW" : "DENY";
  } catch (e) {
    return "DENY";
  }
})();
`;
  // Outer osascript timeout is dialog timeout + 10s buffer so the dialog's own
  // givingUpAfter has a chance to fire before the spawn-level kill engages.
  const result = await runJxa(script, { timeoutMs: (timeoutSec + 10) * 1000 });
  return result.trim() === "ALLOW";
}

export function writeToolsDisabledMessage(toolName: string): string {
  return (
    `${toolName} is disabled. Write tools (terminal_execute, terminal_clear, safety_*) ` +
    `are off by default for safety. To enable, set environment variable ` +
    `WRITE_TOOLS_ENABLED=1 in the MCP server's env block. Each non-"safe" call ` +
    `still prompts via a native macOS dialog.`
  );
}
