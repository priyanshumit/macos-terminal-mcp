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

import { runJxa } from "../../src/applescript.js";
import { buildWaitForIdleScript, waitForIdleHandler } from "../../src/tools/wait_for_idle.js";

const mockedRunJxa = vi.mocked(runJxa);

describe("terminal_wait_for_idle handler", () => {
  beforeEach(() => {
    mockedRunJxa.mockReset();
  });

  it("returns idle result when tab becomes idle", async () => {
    mockedRunJxa.mockResolvedValue(
      JSON.stringify({ tty: "/dev/ttys003", idle: true, waited_ms: 1250 }),
    );
    const result = await waitForIdleHandler({ tty: "/dev/ttys003" });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.idle).toBe(true);
    expect(parsed.waited_ms).toBe(1250);
  });

  it("returns timed_out when the wait exceeds timeout_seconds", async () => {
    mockedRunJxa.mockResolvedValue(
      JSON.stringify({ tty: "/dev/ttys003", timed_out: true, waited_ms: 60000 }),
    );
    const result = await waitForIdleHandler({ tty: "/dev/ttys003" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.timed_out).toBe(true);
  });

  it("returns missing when the target tab no longer exists", async () => {
    mockedRunJxa.mockResolvedValue(
      JSON.stringify({ tty: "/dev/ttys999", missing: true, waited_ms: 0 }),
    );
    const result = await waitForIdleHandler({ tty: "/dev/ttys999" });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.missing).toBe(true);
  });

  it("uses default timeout when none provided", async () => {
    mockedRunJxa.mockResolvedValue(
      JSON.stringify({ tty: "/dev/ttys003", idle: true, waited_ms: 0 }),
    );
    await waitForIdleHandler({ tty: "/dev/ttys003" });
    // Default is 60s; outer timeout is (60 + 5) * 1000 = 65000ms.
    expect(mockedRunJxa).toHaveBeenCalledWith(expect.any(String), { timeoutMs: 65_000 });
  });

  it("passes custom timeout_seconds through to JXA and to runJxa timeoutMs", async () => {
    mockedRunJxa.mockResolvedValue(
      JSON.stringify({ tty: "/dev/ttys003", idle: true, waited_ms: 0 }),
    );
    await waitForIdleHandler({ tty: "/dev/ttys003", timeout_seconds: 120 });
    expect(mockedRunJxa).toHaveBeenCalledWith(expect.any(String), { timeoutMs: 125_000 });
  });

  it("returns isError if runJxa throws", async () => {
    mockedRunJxa.mockRejectedValue(new Error("osascript died"));
    const result = await waitForIdleHandler({ tty: "/dev/ttys003" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_wait_for_idle failed/);
  });

  it("the script embeds the target tty and timeout", () => {
    const script = buildWaitForIdleScript("/dev/ttys042", 90);
    expect(script).toContain('"/dev/ttys042"');
    expect(script).toContain("90");
    expect(script).toContain("t.busy()");
  });
});
