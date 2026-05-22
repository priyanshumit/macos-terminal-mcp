import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendAudit } from "../../src/safety/audit.js";

describe("appendAudit", () => {
  let tmpDir: string;
  let tmpPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "macos-terminal-mcp-audit-test-"));
    tmpPath = join(tmpDir, "audit.log");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("appends a JSONL entry to the file", async () => {
    await appendAudit(
      { tool: "terminal_execute", outcome: "success", tty: "/dev/ttys003", command: "ls" },
      tmpPath,
    );
    const content = await readFile(tmpPath, "utf8");
    expect(content.endsWith("\n")).toBe(true);
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry.tool).toBe("terminal_execute");
    expect(entry.outcome).toBe("success");
    expect(entry.tty).toBe("/dev/ttys003");
    expect(entry.command).toBe("ls");
    expect(typeof entry.timestamp).toBe("string");
  });

  it("auto-supplies a timestamp when omitted", async () => {
    const before = new Date().toISOString();
    await appendAudit({ tool: "terminal_clear", outcome: "denied", tty: "/dev/ttys003" }, tmpPath);
    const after = new Date().toISOString();
    const entry = JSON.parse((await readFile(tmpPath, "utf8")).trim()) as {
      timestamp: string;
    };
    expect(entry.timestamp >= before).toBe(true);
    expect(entry.timestamp <= after).toBe(true);
  });

  it("appends multiple entries one per line", async () => {
    await appendAudit({ tool: "a", outcome: "success" }, tmpPath);
    await appendAudit({ tool: "b", outcome: "denied" }, tmpPath);
    await appendAudit({ tool: "c", outcome: "error" }, tmpPath);
    const lines = (await readFile(tmpPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).tool).toBe("a");
    expect(JSON.parse(lines[1]).tool).toBe("b");
    expect(JSON.parse(lines[2]).tool).toBe("c");
  });

  it("truncates very long commands", async () => {
    const longCommand = "x".repeat(2000);
    await appendAudit(
      { tool: "terminal_execute", outcome: "success", command: longCommand },
      tmpPath,
    );
    const entry = JSON.parse((await readFile(tmpPath, "utf8")).trim()) as {
      command: string;
    };
    expect(entry.command.length).toBeLessThan(longCommand.length);
    expect(entry.command).toContain("…");
  });

  it("is best-effort — does not throw on filesystem errors", async () => {
    // Write to a path inside a non-existent unwritable parent. mkdir will fail
    // because /nonexistent_root_dir cannot be created by a normal user.
    const badPath = "/nonexistent_root_dir/cannot-create/audit.log";
    // Should not throw — the function swallows the error and writes a warning to stderr.
    await expect(appendAudit({ tool: "x", outcome: "success" }, badPath)).resolves.toBeUndefined();
  });

  it("creates the parent directory if missing", async () => {
    const nestedPath = join(tmpDir, "a", "b", "c", "audit.log");
    await appendAudit({ tool: "y", outcome: "success" }, nestedPath);
    const content = await readFile(nestedPath, "utf8");
    expect(content).toContain('"tool":"y"');
  });
});
