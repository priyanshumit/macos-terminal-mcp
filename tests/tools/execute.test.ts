import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/applescript.js", () => ({
  runJxa: vi.fn(),
  runJxaJson: vi.fn(),
  OsascriptError: class OsascriptErrorMock extends Error {
    public stderr: string;
    public code: number;
    public timedOut: boolean;
    public aborted: boolean;
    constructor(message: string, stderr: string, code: number, timedOut = false, aborted = false) {
      super(message);
      this.name = "OsascriptError";
      this.stderr = stderr;
      this.code = code;
      this.timedOut = timedOut;
      this.aborted = aborted;
    }
  },
}));

vi.mock("../../src/safety/confirm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/safety/confirm.js")>();
  return {
    ...actual,
    confirmWithUser: vi.fn(),
    isWriteToolsEnabled: vi.fn(),
    writeToolsDisabledMessage: (name: string) => `${name} disabled`,
  };
});

vi.mock("../../src/safety/patterns.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/safety/patterns.js")>(
    "../../src/safety/patterns.js",
  );
  return {
    ...actual,
    loadSafetyConfig: vi.fn(),
  };
});

import { runJxa } from "../../src/applescript.js";
import { confirmWithUser, isWriteToolsEnabled } from "../../src/safety/confirm.js";
import { loadSafetyConfig } from "../../src/safety/patterns.js";
import { executeHandler } from "../../src/tools/execute.js";

const mockedRunJxa = vi.mocked(runJxa);
const mockedConfirm = vi.mocked(confirmWithUser);
const mockedEnabled = vi.mocked(isWriteToolsEnabled);
const mockedLoadConfig = vi.mocked(loadSafetyConfig);

/**
 * Script-aware mock: returns "idle" for the busy-check JXA (so execute proceeds),
 * "OK" for the actual execute call. Lets tests assert on call counts and contents
 * without coupling to call ordering.
 */
function setRunJxaForIdleTab(): void {
  mockedRunJxa.mockImplementation((script: string) => {
    if (script.includes("checkBusy")) return Promise.resolve("idle");
    return Promise.resolve("OK");
  });
}

function executeScriptOf(calls: Parameters<typeof runJxa>[]): string {
  return (calls.find((c) => !c[0].includes("checkBusy"))?.[0] ?? "") as string;
}

describe("terminal_execute handler", () => {
  beforeEach(() => {
    mockedRunJxa.mockReset();
    mockedConfirm.mockReset();
    mockedEnabled.mockReset();
    mockedLoadConfig.mockReset();
    mockedEnabled.mockReturnValue(true);
    mockedLoadConfig.mockResolvedValue({
      patterns: [
        { pattern: "^ls\\b", level: "safe" },
        { pattern: "\\bsudo\\b", level: "forbidden", description: "test forbid" },
      ],
    });
  });

  it("refuses when WRITE_TOOLS_ENABLED is false", async () => {
    mockedEnabled.mockReturnValue(false);

    const result = await executeHandler({ tty: "/dev/ttys003", command: "ls" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/disabled/);
    expect(mockedRunJxa).not.toHaveBeenCalled();
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it("refuses outright for forbidden patterns — no dialog, no execution", async () => {
    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "sudo something",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/FORBIDDEN/);
    expect((result.content[0] as { text: string }).text).toMatch(/test forbid/);
    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(mockedRunJxa).not.toHaveBeenCalled();
  });

  it("auto-runs for safe patterns without a confirmation dialog", async () => {
    setRunJxaForIdleTab();

    const result = await executeHandler({ tty: "/dev/ttys003", command: "ls -la" });

    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toMatch(/auto-run/);
    expect((result.content[0] as { text: string }).text).toMatch(/safe pattern/);
    expect(mockedConfirm).not.toHaveBeenCalled();
    // Busy check + execute = 2 calls
    expect(mockedRunJxa).toHaveBeenCalledTimes(2);
  });

  it("prompts and runs when dialog approves for requires_approval verdict", async () => {
    mockedConfirm.mockResolvedValue(true);
    setRunJxaForIdleTab();

    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "cargo build",
    });

    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toMatch(/approved via dialog/);
    expect(mockedConfirm).toHaveBeenCalledOnce();
    expect(mockedRunJxa).toHaveBeenCalledTimes(2);
  });

  it("prompts and rejects when dialog denies", async () => {
    mockedConfirm.mockResolvedValue(false);
    setRunJxaForIdleTab();

    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "cargo build",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/denied via dialog/);
    expect(mockedConfirm).toHaveBeenCalledOnce();
    // Busy check ran; execute did NOT.
    expect(mockedRunJxa).toHaveBeenCalledTimes(1);
  });

  it("passes the target tty into the JXA script when running", async () => {
    setRunJxaForIdleTab();

    await executeHandler({ tty: "/dev/ttys042", command: "ls" });

    const script = executeScriptOf(mockedRunJxa.mock.calls);
    expect(script).toContain('"/dev/ttys042"');
    expect(script).toContain("doScript");
  });

  it("passes the command into the JXA script when running", async () => {
    setRunJxaForIdleTab();

    await executeHandler({ tty: "/dev/ttys003", command: "ls -la" });

    const script = executeScriptOf(mockedRunJxa.mock.calls);
    expect(script).toContain('"ls -la"');
  });

  it("honors highest-restriction-wins (forbidden beats safe in composite)", async () => {
    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "ls && sudo x",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/FORBIDDEN/);
    expect(mockedRunJxa).not.toHaveBeenCalled();
  });

  it("returns isError when the underlying JXA execution fails", async () => {
    mockedRunJxa.mockImplementation((script: string) => {
      if (script.includes("checkBusy")) return Promise.resolve("idle");
      return Promise.reject(new Error("no such tab"));
    });

    const result = await executeHandler({ tty: "/dev/ttys003", command: "ls" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_execute failed/);
    expect((result.content[0] as { text: string }).text).toMatch(/no such tab/);
  });

  // ---------- Reviewer #1: busy-tab check ----------

  it("refuses when target tab is busy (reviewer #1)", async () => {
    mockedRunJxa.mockImplementation((script: string) => {
      if (script.includes("checkBusy")) return Promise.resolve("busy");
      return Promise.resolve("OK");
    });

    const result = await executeHandler({ tty: "/dev/ttys003", command: "ls" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/is busy/);
    expect((result.content[0] as { text: string }).text).toMatch(/force=true/);
    // Only the busy check ran; the execute did not.
    expect(mockedRunJxa).toHaveBeenCalledTimes(1);
  });

  it("bypasses busy check when force=true", async () => {
    mockedRunJxa.mockResolvedValue("OK"); // both calls return OK; force=true skips busy probe

    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "ls",
      force: true,
    });

    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toMatch(/force=true/);
    // Only execute ran (no busy probe).
    expect(mockedRunJxa).toHaveBeenCalledTimes(1);
    const script = (mockedRunJxa.mock.calls[0][0] as string) ?? "";
    expect(script).not.toContain("checkBusy");
  });

  it("reports missing tab when busy probe returns 'missing'", async () => {
    mockedRunJxa.mockImplementation((script: string) => {
      if (script.includes("checkBusy")) return Promise.resolve("missing");
      return Promise.resolve("OK");
    });

    const result = await executeHandler({ tty: "/dev/ttys999", command: "ls" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/No Terminal\.app tab/);
  });

  // ---------- Reviewer #3: dry_run mode ----------

  it("dry_run returns the verdict with no side effects (reviewer #3)", async () => {
    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "ls -la",
      dry_run: true,
    });

    expect(result.isError).toBeUndefined();
    expect(mockedRunJxa).not.toHaveBeenCalled();
    expect(mockedConfirm).not.toHaveBeenCalled();
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.verdict).toBe("safe");
    expect(parsed.wouldAutoRun).toBe(true);
    expect(parsed.wouldPromptUser).toBe(false);
    expect(parsed.wouldRefuse).toBe(false);
  });

  it("dry_run reports forbidden verdict without refusing", async () => {
    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "sudo reboot",
      dry_run: true,
    });

    // dry_run never produces isError — it's a query, not an action.
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.verdict).toBe("forbidden");
    expect(parsed.wouldRefuse).toBe(true);
    expect(parsed.matchedPattern).toBeDefined();
  });

  it("dry_run reports requires_approval for unknown commands", async () => {
    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "cargo build",
      dry_run: true,
    });

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.verdict).toBe("requires_approval");
    expect(parsed.wouldPromptUser).toBe(true);
  });
});
