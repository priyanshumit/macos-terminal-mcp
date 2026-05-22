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

import { OsascriptError, runJxa } from "../../src/applescript.js";
import { listHandler } from "../../src/tools/list.js";

const mockedRunJxa = vi.mocked(runJxa);

describe("terminal_list handler", () => {
  beforeEach(() => {
    mockedRunJxa.mockReset();
  });

  it("returns the JSON output verbatim on success", async () => {
    const fakeJson = '[{"windowId":1,"tty":"/dev/ttys001"}]';
    mockedRunJxa.mockResolvedValue(fakeJson);

    const result = await listHandler();

    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text", text: fakeJson });
    expect(mockedRunJxa).toHaveBeenCalledOnce();
  });

  it("returns isError when runJxa rejects", async () => {
    mockedRunJxa.mockRejectedValue(new Error("boom"));

    const result = await listHandler();

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_list failed/);
    expect((result.content[0] as { text: string }).text).toMatch(/boom/);
  });

  it("adds an Automation-permission hint when the error stderr contains 'not authorized'", async () => {
    mockedRunJxa.mockRejectedValue(
      new OsascriptError(
        "osascript exited 1: Not authorized to send Apple events",
        "Not authorized to send Apple events",
        1,
      ),
    );

    const result = await listHandler();

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/Automation permission/);
    expect(text).toMatch(/System Settings/);
  });
});
