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
    isWriteToolsEnabled: vi.fn(),
    writeToolsDisabledMessage: (name: string) => `${name} disabled`,
  };
});

import { runJxa } from "../../src/applescript.js";
import { isWriteToolsEnabled } from "../../src/safety/confirm.js";
import { newTabHandler } from "../../src/tools/new_tab.js";

const mockedRunJxa = vi.mocked(runJxa);
const mockedEnabled = vi.mocked(isWriteToolsEnabled);

describe("terminal_new_tab handler", () => {
  beforeEach(() => {
    mockedRunJxa.mockReset();
    mockedEnabled.mockReset();
    mockedEnabled.mockReturnValue(true);
  });

  it("refuses when WRITE_TOOLS_ENABLED is false", async () => {
    mockedEnabled.mockReturnValue(false);

    const result = await newTabHandler();

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/disabled/);
    expect(mockedRunJxa).not.toHaveBeenCalled();
  });

  it("returns the new tty + windowId on success", async () => {
    mockedRunJxa.mockResolvedValue('{"tty":"/dev/ttys099","windowId":131200}');

    const result = await newTabHandler();

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.tty).toBe("/dev/ttys099");
    expect(parsed.windowId).toBe(131200);
  });

  it("returns isError when JXA fails", async () => {
    mockedRunJxa.mockRejectedValue(new Error("Terminal.app not running"));

    const result = await newTabHandler();

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_new_tab failed/);
    expect((result.content[0] as { text: string }).text).toMatch(/Terminal\.app not running/);
  });

  it("does NOT invoke any confirmation dialog (low blast radius)", async () => {
    mockedRunJxa.mockResolvedValue('{"tty":"/dev/ttys099","windowId":131200}');

    await newTabHandler();

    // confirmWithUser is not imported by new_tab.ts at all — verify the script
    // doesn't even mention a dialog primitive.
    const script = (mockedRunJxa.mock.calls[0]?.[0] as string) ?? "";
    expect(script).not.toContain("displayDialog");
  });
});
