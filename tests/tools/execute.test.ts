import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/applescript.js", () => ({
  runJxa: vi.fn(),
  runJxaJson: vi.fn(),
  OsascriptError: class OsascriptErrorMock extends Error {
    public stderr: string;
    public code: number;
    public timedOut: boolean;
    constructor(message: string, stderr: string, code: number, timedOut = false) {
      super(message);
      this.name = "OsascriptError";
      this.stderr = stderr;
      this.code = code;
      this.timedOut = timedOut;
    }
  },
}));

vi.mock("../../src/safety/confirm.js", () => ({
  confirmWithUser: vi.fn(),
  isWriteToolsEnabled: vi.fn(),
  writeToolsDisabledMessage: (name: string) => `${name} disabled`,
}));

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
    mockedRunJxa.mockResolvedValue("OK");

    const result = await executeHandler({ tty: "/dev/ttys003", command: "ls -la" });

    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toMatch(/auto-run/);
    expect((result.content[0] as { text: string }).text).toMatch(/safe pattern/);
    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(mockedRunJxa).toHaveBeenCalledOnce();
  });

  it("prompts and runs when dialog approves for requires_approval verdict", async () => {
    mockedConfirm.mockResolvedValue(true);
    mockedRunJxa.mockResolvedValue("OK");

    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "cargo build", // matches neither safe nor forbidden → default requires_approval
    });

    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toMatch(/approved via dialog/);
    expect(mockedConfirm).toHaveBeenCalledOnce();
    expect(mockedRunJxa).toHaveBeenCalledOnce();
  });

  it("prompts and rejects when dialog denies", async () => {
    mockedConfirm.mockResolvedValue(false);

    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "cargo build",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/denied via dialog/);
    expect(mockedConfirm).toHaveBeenCalledOnce();
    expect(mockedRunJxa).not.toHaveBeenCalled();
  });

  it("passes the target tty into the JXA script when running", async () => {
    mockedRunJxa.mockResolvedValue("OK");

    await executeHandler({ tty: "/dev/ttys042", command: "ls" });

    const script = mockedRunJxa.mock.calls[0][0] as string;
    expect(script).toContain('"/dev/ttys042"');
  });

  it("passes the command into the JXA script when running", async () => {
    mockedRunJxa.mockResolvedValue("OK");

    await executeHandler({ tty: "/dev/ttys003", command: "ls -la" });

    const script = mockedRunJxa.mock.calls[0][0] as string;
    expect(script).toContain('"ls -la"');
  });

  it("honors highest-restriction-wins (forbidden beats safe in composite)", async () => {
    // "ls && sudo x" — ^ls matches (safe), \bsudo\b matches (forbidden) → forbidden wins
    const result = await executeHandler({
      tty: "/dev/ttys003",
      command: "ls && sudo x",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/FORBIDDEN/);
    expect(mockedRunJxa).not.toHaveBeenCalled();
  });

  it("returns isError when the underlying JXA execution fails", async () => {
    mockedRunJxa.mockRejectedValue(new Error("no such tab"));

    const result = await executeHandler({ tty: "/dev/ttys003", command: "ls" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_execute failed/);
    expect((result.content[0] as { text: string }).text).toMatch(/no such tab/);
  });
});
