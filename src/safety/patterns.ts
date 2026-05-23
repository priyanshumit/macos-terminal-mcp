import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import safeRegex from "safe-regex";

export type SafetyLevel = "safe" | "requires_approval" | "forbidden";

/**
 * Reason a pattern is rejected, or null if the pattern is valid + safe.
 * "Safe" here means: does not contain catastrophic-backtracking constructs
 * (e.g. (a+)+b, (\w+)+!) that would let a single pattern DoS the server.
 */
export function regexErrorReason(pattern: string): string | null {
  try {
    new RegExp(pattern);
  } catch (e) {
    return `not a valid regex: ${(e as Error).message}`;
  }
  if (!safeRegex(pattern)) {
    return "contains a ReDoS-prone construct (nested quantifiers, overlapping repeats, or ambiguous alternations)";
  }
  return null;
}

export function isSafePattern(pattern: string): boolean {
  return regexErrorReason(pattern) === null;
}

export interface PatternEntry {
  pattern: string;
  level: SafetyLevel;
  description?: string;
}

export interface SafetyConfig {
  patterns: PatternEntry[];
}

export const SAFETY_CONFIG_PATH = join(homedir(), ".config", "macos-terminal-mcp", "safety.json");

const DEFAULT_PATTERNS: PatternEntry[] = [
  // FORBIDDEN — never run, even with confirmation. The user must run these in a terminal themselves.
  {
    pattern: "\\brm\\s+-rf?\\b",
    level: "forbidden",
    description: "Recursive rm — too destructive to expose to an AI agent",
  },
  {
    pattern: "\\bsudo\\b",
    level: "forbidden",
    description: "Privilege escalation should always be done by a human",
  },
  {
    pattern: "\\|\\s*(bash|sh|zsh)\\b",
    level: "forbidden",
    description: "Piping into a shell — common attack vector",
  },
  {
    pattern: "\\bcurl\\b[^|;]*\\|",
    level: "forbidden",
    description: "curl piped to another command",
  },
  {
    pattern: "\\bwget\\b[^|;]*\\|",
    level: "forbidden",
    description: "wget piped to another command",
  },
  { pattern: ">\\s*/etc/", level: "forbidden", description: "Writing to /etc" },
  { pattern: ">\\s*/dev/", level: "forbidden", description: "Writing to /dev" },
  { pattern: "/etc/passwd", level: "forbidden", description: "Touching /etc/passwd" },
  { pattern: "/etc/shadow", level: "forbidden", description: "Touching /etc/shadow" },
  { pattern: "~/.ssh", level: "forbidden", description: "Touching SSH keys" },
  { pattern: "\\bdd\\s+if=", level: "forbidden", description: "dd — can overwrite disks" },
  { pattern: ":\\(\\)\\{:\\|:&\\};:", level: "forbidden", description: "Fork bomb" },
  { pattern: "\\bshutdown\\b", level: "forbidden", description: "System shutdown" },
  { pattern: "\\breboot\\b", level: "forbidden", description: "System reboot" },
  { pattern: "\\bkillall\\b", level: "forbidden", description: "Mass process kill" },
  {
    pattern: "\\bgit\\s+push\\s+(--force|-f)\\b",
    level: "forbidden",
    description: "Force push — usually a mistake",
  },
  {
    pattern: "\\bgit\\s+reset\\s+--hard\\b",
    level: "forbidden",
    description: "git reset --hard — discards local work",
  },
  {
    pattern: "\\bgit\\s+clean\\s+-[fdx]+\\b",
    level: "forbidden",
    description: "git clean with -f flags — destructive",
  },

  // SAFE — auto-run, no confirmation needed.
  { pattern: "^ls(\\s|$)", level: "safe", description: "List directory contents" },
  { pattern: "^pwd(\\s|$)", level: "safe", description: "Print working directory" },
  { pattern: "^cd(\\s|$)", level: "safe", description: "Change directory" },
  { pattern: "^echo(\\s|$)", level: "safe", description: "Echo arguments" },
  { pattern: "^cat\\s", level: "safe", description: "Print file contents" },
  { pattern: "^less\\s", level: "safe", description: "Page through a file" },
  { pattern: "^head\\s", level: "safe", description: "First N lines of a file" },
  { pattern: "^tail\\s", level: "safe", description: "Last N lines of a file" },
  { pattern: "^which\\s", level: "safe", description: "Locate a command" },
  { pattern: "^type\\s", level: "safe", description: "Describe a command" },
  { pattern: "^date(\\s|$)", level: "safe", description: "Current date/time" },
  { pattern: "^whoami(\\s|$)", level: "safe", description: "Current user" },
  { pattern: "^uptime(\\s|$)", level: "safe", description: "System uptime" },
  {
    pattern: "^git\\s+(status|log|diff|branch|show|remote|stash list)\\b",
    level: "safe",
    description: "Read-only git operations",
  },
  {
    pattern: "^npm\\s+(test|run\\s+test|run\\s+lint|run\\s+typecheck)\\b",
    level: "safe",
    description: "Common npm read-ish operations",
  },
  { pattern: "^node\\s+--version\\b", level: "safe" },
  { pattern: "^python3?\\s+--version\\b", level: "safe" },
];

export async function loadSafetyConfig(path: string = SAFETY_CONFIG_PATH): Promise<SafetyConfig> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch {
    return { patterns: DEFAULT_PATTERNS };
  }
}

export async function saveSafetyConfig(
  config: SafetyConfig,
  path: string = SAFETY_CONFIG_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function defaultPatterns(): PatternEntry[] {
  return DEFAULT_PATTERNS.map((p) => ({ ...p }));
}

function filterSafePatterns(patterns: PatternEntry[]): PatternEntry[] {
  return patterns.filter((e) => {
    if (isSafePattern(e.pattern)) return true;
    process.stderr.write(
      `[macos-terminal-mcp] dropping unsafe pattern from config: ${JSON.stringify(e.pattern)} (${regexErrorReason(e.pattern) ?? "unknown"})\n`,
    );
    return false;
  });
}

export function normalizeConfig(raw: unknown): SafetyConfig {
  if (!raw || typeof raw !== "object") return { patterns: DEFAULT_PATTERNS };
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.patterns)) {
    const valid = o.patterns.filter((e: unknown): e is PatternEntry => isValidEntry(e));
    return { patterns: filterSafePatterns(valid) };
  }
  // Migrate v1 schema {allowlist: [], denylist: []} → v2 {patterns: [...]}
  if (Array.isArray(o.allowlist) || Array.isArray(o.denylist)) {
    const patterns: PatternEntry[] = [];
    if (Array.isArray(o.denylist)) {
      for (const p of o.denylist) {
        if (typeof p === "string") {
          patterns.push({
            pattern: p,
            level: "requires_approval",
            description: "Migrated from v1 denylist",
          });
        }
      }
    }
    if (Array.isArray(o.allowlist)) {
      for (const p of o.allowlist) {
        if (typeof p === "string") {
          patterns.push({
            pattern: p,
            level: "safe",
            description: "Migrated from v1 allowlist",
          });
        }
      }
    }
    const filtered = filterSafePatterns(patterns);
    return { patterns: filtered.length > 0 ? filtered : DEFAULT_PATTERNS };
  }
  return { patterns: DEFAULT_PATTERNS };
}

function isValidEntry(e: unknown): e is PatternEntry {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.pattern === "string" &&
    (o.level === "safe" || o.level === "requires_approval" || o.level === "forbidden") &&
    (o.description === undefined || typeof o.description === "string")
  );
}

export interface SafetyVerdict {
  level: SafetyLevel;
  matchedPattern?: string;
  matchedDescription?: string;
}

const LEVEL_RANK: Record<SafetyLevel, number> = {
  safe: 0,
  requires_approval: 1,
  forbidden: 2,
};

export function evaluateCommand(command: string, config: SafetyConfig): SafetyVerdict {
  // Normalize via NFKC so fullwidth/compatibility Unicode characters fold to
  // their ASCII equivalents. Closes the ｒｍ -rf homoglyph bypass — a model
  // submitting Unicode lookalikes can't sneak past patterns using \b assertions.
  const normalized = command.normalize("NFKC");
  let result: SafetyVerdict | null = null;
  for (const entry of config.patterns) {
    if (!testPattern(entry.pattern, normalized)) continue;
    if (!result || LEVEL_RANK[entry.level] > LEVEL_RANK[result.level]) {
      result = {
        level: entry.level,
        matchedPattern: entry.pattern,
        matchedDescription: entry.description,
      };
    }
  }
  // No pattern matched — default is requires_approval (safer than safe)
  return result ?? { level: "requires_approval" };
}

function testPattern(pattern: string, command: string): boolean {
  try {
    return new RegExp(pattern).test(command);
  } catch {
    return false;
  }
}
