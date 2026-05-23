import { OsascriptError, runJxa } from "../applescript.js";

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
  /** Programmatically dismiss the dialog. SIGKILLs the underlying osascript child so the dialog disappears from the user's screen. Use when an out-of-band approval (e.g. pending_approve) has already resolved the awaiting flow. */
  signal?: AbortSignal;
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
  try {
    const result = await runJxa(script, {
      timeoutMs: (timeoutSec + 10) * 1000,
      signal: req.signal,
    });
    return result.trim() === "ALLOW";
  } catch (err) {
    // Aborted via signal — treat as denial. Caller is responsible for its own
    // out-of-band approval path (e.g. queue resolution); we just dismiss the dialog.
    if (err instanceof OsascriptError && err.aborted) {
      return false;
    }
    throw err;
  }
}

/**
 * Strip C0 control characters (including newlines, tabs, CR) from AI-supplied
 * strings before embedding them in confirmation dialog message templates.
 *
 * Without this, a model can inject fake structured fields like "Queue id: ..."
 * or "Approval: GRANTED" inside a dialog's text by including newlines in its
 * command/description, visually impersonating system-rendered content.
 */
// Pattern is constructed via new RegExp(string) to avoid embedding literal
// control bytes in the source file (which Biome flags and which is also hard
// to audit visually). Matches C0 control characters (U+0000–U+001F) plus DEL.
// biome-ignore lint/complexity/useRegexLiterals: regex-literal form trips noControlCharactersInRegex on the same character class (escape sequences vs bytes both flagged). RegExp(string) avoids the false positive without obscuring intent.
const CONTROL_CHARS_RE = new RegExp("[\u0000-\u001F\u007F]", "g");

export function sanitizeAiText(s: string): string {
  return s.replace(CONTROL_CHARS_RE, " ");
}

export function writeToolsDisabledMessage(toolName: string): string {
  return (
    `${toolName} is disabled. Write tools (terminal_execute, terminal_clear, safety_*) ` +
    `are off by default for safety. To enable, set environment variable ` +
    `WRITE_TOOLS_ENABLED=1 in the MCP server's env block. Each non-"safe" call ` +
    `still prompts via a native macOS dialog.`
  );
}
