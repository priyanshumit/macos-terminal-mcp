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

import { runJxa } from "../../src/applescript.js";
import { readHandler } from "../../src/tools/read.js";

const mockedRunJxa = vi.mocked(runJxa);

describe("terminal_read handler", () => {
  beforeEach(() => {
    mockedRunJxa.mockReset();
  });

  it("returns the JXA contents as text", async () => {
    mockedRunJxa.mockResolvedValue("line1\nline2\nline3");

    const result = await readHandler({ tty: "/dev/ttys003" });

    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toBe("line1\nline2\nline3");
  });

  it("interpolates the target tty into the JXA script", async () => {
    mockedRunJxa.mockResolvedValue("");

    await readHandler({ tty: "/dev/ttys042" });

    const script = mockedRunJxa.mock.calls[0][0] as string;
    expect(script).toContain('"/dev/ttys042"');
  });

  it("truncates output to the last N lines when lines is provided", async () => {
    mockedRunJxa.mockResolvedValue("a\nb\nc\nd\ne");

    const result = await readHandler({ tty: "/dev/ttys003", lines: 2 });

    expect((result.content[0] as { text: string }).text).toBe("d\ne");
  });

  it("returns full content when lines is omitted", async () => {
    mockedRunJxa.mockResolvedValue("a\nb\nc\nd\ne");

    const result = await readHandler({ tty: "/dev/ttys003" });

    expect((result.content[0] as { text: string }).text).toBe("a\nb\nc\nd\ne");
  });

  it("returns isError on failure", async () => {
    mockedRunJxa.mockRejectedValue(new Error("missing tab"));

    const result = await readHandler({ tty: "/dev/ttys999" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_read failed/);
  });
});
