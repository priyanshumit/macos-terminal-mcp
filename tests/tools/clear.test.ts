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

vi.mock("../../src/safety/confirm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/safety/confirm.js")>();
  return {
    ...actual,
    confirmWithUser: vi.fn(),
    isWriteToolsEnabled: vi.fn(),
    writeToolsDisabledMessage: (name: string) => `${name} disabled`,
  };
});

import { runJxa } from "../../src/applescript.js";
import { confirmWithUser, isWriteToolsEnabled } from "../../src/safety/confirm.js";
import { buildClearScript, clearHandler } from "../../src/tools/clear.js";

const mockedRunJxa = vi.mocked(runJxa);
const mockedConfirm = vi.mocked(confirmWithUser);
const mockedEnabled = vi.mocked(isWriteToolsEnabled);

describe("terminal_clear handler", () => {
  beforeEach(() => {
    mockedRunJxa.mockReset();
    mockedConfirm.mockReset();
    mockedEnabled.mockReset();
    mockedEnabled.mockReturnValue(true);
  });

  it("refuses when WRITE_TOOLS_ENABLED is false", async () => {
    mockedEnabled.mockReturnValue(false);

    const result = await clearHandler({ tty: "/dev/ttys003" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/disabled/);
    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(mockedRunJxa).not.toHaveBeenCalled();
  });

  it("aborts when user denies the confirmation dialog", async () => {
    mockedConfirm.mockResolvedValue(false);

    const result = await clearHandler({ tty: "/dev/ttys003" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/denied/);
    expect(mockedRunJxa).not.toHaveBeenCalled();
  });

  it("calls runJxa with the clear script when user approves", async () => {
    mockedConfirm.mockResolvedValue(true);
    mockedRunJxa.mockResolvedValue("OK");

    const result = await clearHandler({ tty: "/dev/ttys003" });

    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toMatch(/Cleared scrollback/);
    expect(mockedRunJxa).toHaveBeenCalledOnce();
  });

  it("uses delay() from Standard Additions (regression guard for $.usleep bug)", () => {
    // The original bug was using $.usleep which isn't available via ObjC.import("stdlib")
    // in some macOS versions. Verify the script uses delay() and includeStandardAdditions.
    const script = buildClearScript("/dev/ttys003");
    expect(script).toContain("includeStandardAdditions");
    expect(script).toContain("delay(0.2)");
    expect(script).not.toContain("$.usleep");
  });

  it("interpolates the target tty into the script", () => {
    const script = buildClearScript("/dev/ttys042");
    expect(script).toContain('"/dev/ttys042"');
  });

  it("returns isError when runJxa fails", async () => {
    mockedConfirm.mockResolvedValue(true);
    mockedRunJxa.mockRejectedValue(new Error("no focus"));

    const result = await clearHandler({ tty: "/dev/ttys003" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_clear failed/);
    expect((result.content[0] as { text: string }).text).toMatch(/no focus/);
  });
});
