import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readAuditTail } from "../safety/audit.js";

export interface AuditTailInput {
  count?: number;
}

export async function auditTailHandler({ count = 20 }: AuditTailInput): Promise<CallToolResult> {
  try {
    const entries = await readAuditTail(count);
    return {
      content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `audit_log_tail failed: ${message}` }],
      isError: true,
    };
  }
}

export function register(server: McpServer): void {
  server.registerTool(
    "audit_log_tail",
    {
      description:
        "Read the last N entries from the audit log (~/.local/state/macos-terminal-mcp/audit.log, or $XDG_STATE_HOME equivalent). Each entry is a JSON object with {timestamp, tool, outcome, tty?, command?, level?, matchedPattern?, source?, errorMessage?, details?}. Read-only — does not require WRITE_TOOLS_ENABLED and is not itself logged. Returns [] if the log file does not exist yet.",
      inputSchema: {
        count: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Number of entries to return from the tail of the log. Default 20, max 1000."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    auditTailHandler,
  );
}
