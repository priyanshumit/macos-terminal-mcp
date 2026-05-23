import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
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

/**
 * Append a JSONL audit entry. Best-effort — failures are logged to stderr but do
 * not throw. Timestamp is always server-generated; callers cannot override it.
 *
 * Directory created with mode 0o700, file with mode 0o600. If the file already
 * exists with wider permissions (e.g. from an older version), it is tightened
 * to 0o600 on every write (no-op once already restricted).
 */
export async function appendAudit(
  entry: Omit<AuditEntry, "timestamp">,
  path: string = AUDIT_LOG_PATH,
): Promise<void> {
  // Spread entry first, then always overwrite timestamp last so any type-cast
  // bypass that smuggles a "timestamp" field in entry still loses to the
  // server-generated value.
  const record: AuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  if (record.command !== undefined) {
    record.command = truncate(record.command, COMMAND_TRUNCATE);
  }
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Best-effort tighten of any pre-existing file permissions. Ignored if file
    // doesn't yet exist (next appendFile creates it with mode 0o600 below).
    await chmod(path, 0o600).catch(() => undefined);
    await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    process.stderr.write(
      `[macos-terminal-mcp] audit log write failed: ${(err as Error).message}\n`,
    );
  }
}

/**
 * Read the last N JSONL entries from the audit log. Returns [] if the file
 * does not exist (no write tool calls have happened yet).
 *
 * Malformed lines are silently skipped — the audit log is best-effort writes
 * and a corrupt entry shouldn't break the read path.
 */
export async function readAuditTail(
  count: number,
  path: string = AUDIT_LOG_PATH,
): Promise<AuditEntry[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const lines = content.split("\n").filter((l) => l.length > 0);
  const tail = lines.slice(-count);
  const entries: AuditEntry[] = [];
  for (const line of tail) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      // Defensive: skip malformed lines.
    }
  }
  return entries;
}
