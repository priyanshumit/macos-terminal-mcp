import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { runJxa } from "../applescript.js";

const DEFAULT_TIMEOUT_SEC = 60;
const MAX_TIMEOUT_SEC = 600;
const POLL_INTERVAL_SEC = 0.25;

export function buildWaitForIdleScript(tty: string, timeoutSec: number): string {
  return `
function safe(fn) { try { return fn(); } catch (e) { return null; } }
var app = Application.currentApplication();
app.includeStandardAdditions = true;
(function waitForIdle(targetTty, timeoutSec) {
  const terminal = Application("Terminal");
  const startMs = Date.now();
  const deadlineMs = startMs + timeoutSec * 1000;

  function probe() {
    const wins = terminal.windows();
    for (let wi = 0; wi < wins.length; wi++) {
      const w = wins[wi];
      const tabs = w.tabs();
      for (let ti = 0; ti < tabs.length; ti++) {
        const t = tabs[ti];
        if (safe(function () { return t.tty(); }) === targetTty) {
          return { found: true, busy: safe(function () { return t.busy(); }) === true };
        }
      }
    }
    return { found: false, busy: false };
  }

  let state = probe();
  if (!state.found) {
    return JSON.stringify({ tty: targetTty, missing: true, waited_ms: 0 });
  }
  if (!state.busy) {
    return JSON.stringify({ tty: targetTty, idle: true, waited_ms: 0 });
  }

  while (Date.now() < deadlineMs) {
    delay(${POLL_INTERVAL_SEC});
    state = probe();
    if (!state.found) {
      return JSON.stringify({ tty: targetTty, missing: true, waited_ms: Date.now() - startMs });
    }
    if (!state.busy) {
      return JSON.stringify({ tty: targetTty, idle: true, waited_ms: Date.now() - startMs });
    }
  }

  return JSON.stringify({ tty: targetTty, timed_out: true, waited_ms: Date.now() - startMs });
})(${JSON.stringify(tty)}, ${timeoutSec});
`;
}

export interface WaitForIdleInput {
  tty: string;
  timeout_seconds?: number;
}

export async function waitForIdleHandler({
  tty,
  timeout_seconds = DEFAULT_TIMEOUT_SEC,
}: WaitForIdleInput): Promise<CallToolResult> {
  const timeoutSec = Math.min(Math.max(timeout_seconds, 1), MAX_TIMEOUT_SEC);
  try {
    // Outer runJxa timeout is the inner poll deadline + 5s buffer to let the
    // JXA finish writing its "timed_out" result before SIGKILL engages.
    const raw = await runJxa(buildWaitForIdleScript(tty, timeoutSec), {
      timeoutMs: (timeoutSec + 5) * 1000,
    });
    return { content: [{ type: "text", text: raw }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `terminal_wait_for_idle failed: ${message}` }],
      isError: true,
    };
  }
}

export function register(server: McpServer): void {
  server.registerTool(
    "terminal_wait_for_idle",
    {
      description:
        "Block until the target Terminal.app tab is no longer busy (no foreground command running), or until timeout. Polls every 250ms inside a single osascript invocation. Useful for sequential workflows like 'run npm install, then run npm test'. Returns one of {idle: true, waited_ms}, {timed_out: true, waited_ms}, or {missing: true, waited_ms}. Read-only — no WRITE_TOOLS_ENABLED gate.",
      inputSchema: {
        tty: z
          .string()
          .regex(/^\/dev\/ttys[0-9]+$/)
          .describe('Target tab tty, e.g. "/dev/ttys003"'),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(MAX_TIMEOUT_SEC)
          .optional()
          .describe(
            `Maximum seconds to wait before giving up. Default ${DEFAULT_TIMEOUT_SEC}, max ${MAX_TIMEOUT_SEC}.`,
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    waitForIdleHandler,
  );
}
