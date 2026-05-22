import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SafetyLevel } from "./patterns.js";

export type AuditOutcome = "success" | "denied" | "refused" | "error";

export interface AuditEntry {
  timestamp: string;
  tool: string;
  outcome: AuditOutcome;
  tty?: string;
  command?: string;
  pattern?: string;
  level?: SafetyLevel;
  matchedPattern?: string;
  source?: "dialog" | "queue" | "expired" | "auto";
  errorMessage?: string;
  details?: Record<string, unknown>;
}

function resolveDefaultPath(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "state");
  return join(base, "macos-terminal-mcp", "audit.log");
}

export const AUDIT_LOG_PATH = resolveDefaultPath();

const COMMAND_TRUNCATE = 1000;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[+${s.length - max}]` : s;
}

export async function appendAudit(
  entry: Omit<AuditEntry, "timestamp"> & { timestamp?: string },
  path: string = AUDIT_LOG_PATH,
): Promise<void> {
  const record: AuditEntry = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    ...entry,
  };
  if (record.command !== undefined) {
    record.command = truncate(record.command, COMMAND_TRUNCATE);
  }
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    process.stderr.write(
      `[macos-terminal-mcp] audit log write failed: ${(err as Error).message}\n`,
    );
  }
}
