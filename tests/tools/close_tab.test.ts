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
import { buildCloseTabScript, closeTabHandler } from "../../src/tools/close_tab.js";

const mockedRunJxa = vi.mocked(runJxa);
const mockedEnabled = vi.mocked(isWriteToolsEnabled);

describe("terminal_close_tab handler", () => {
  beforeEach(() => {
    mockedRunJxa.mockReset();
    mockedEnabled.mockReset();
    mockedEnabled.mockReturnValue(true);
  });

  it("refuses when WRITE_TOOLS_ENABLED is false", async () => {
    mockedEnabled.mockReturnValue(false);
    const result = await closeTabHandler({ tty: "/dev/ttys003" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/disabled/);
    expect(mockedRunJxa).not.toHaveBeenCalled();
  });

  it("closes an idle tab and returns success", async () => {
    mockedRunJxa.mockResolvedValue(
      JSON.stringify({ status: "closed", tty: "/dev/ttys003", killedRunningCommand: false }),
    );
    const result = await closeTabHandler({ tty: "/dev/ttys003" });
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toMatch(/Closed \/dev\/ttys003/);
  });

  it("refuses a busy tab without force=true (with hint)", async () => {
    mockedRunJxa.mockResolvedValue(JSON.stringify({ status: "busy", tty: "/dev/ttys003" }));
    const result = await closeTabHandler({ tty: "/dev/ttys003" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/is busy/);
    expect((result.content[0] as { text: string }).text).toMatch(/force=true/);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_wait_for_idle/);
  });

  it("closes a busy tab when force=true (notes the kill)", async () => {
    mockedRunJxa.mockResolvedValue(
      JSON.stringify({ status: "closed", tty: "/dev/ttys003", killedRunningCommand: true }),
    );
    const result = await closeTabHandler({ tty: "/dev/ttys003", force: true });
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toMatch(/killed running command/);
  });

  it("reports missing tab when JXA returns status=missing", async () => {
    mockedRunJxa.mockResolvedValue(JSON.stringify({ status: "missing", tty: "/dev/ttys999" }));
    const result = await closeTabHandler({ tty: "/dev/ttys999" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/No Terminal\.app tab/);
  });

  it("returns isError when JXA throws", async () => {
    mockedRunJxa.mockRejectedValue(new Error("Terminal.app crashed"));
    const result = await closeTabHandler({ tty: "/dev/ttys003" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/terminal_close_tab failed/);
  });

  it("passes the tty and force flag into the JXA script", () => {
    const script = buildCloseTabScript("/dev/ttys042", true);
    expect(script).toContain('"/dev/ttys042"');
    expect(script).toContain("true");
  });

  // Regression: v0.6.1 used w.close() which closed the ENTIRE physical window,
  // killing sibling tabs (verified live: a 3-tab window lost two tabs when
  // closing one). The fix mirrors terminal_clear: activate Terminal, select
  // the target tab, then send Cmd+W via System Events.
  it("uses System Events Cmd+W on the selected tab, not w.close() or t.close()", () => {
    const script = buildCloseTabScript("/dev/ttys042", false);
    // Must use the keystroke path
    expect(script).toContain("System Events");
    expect(script).toMatch(/keystroke\(\s*"w"/);
    expect(script).toContain("command down");
    // Must NOT use the broken close-verb approaches (as actual statements; the
    // explanatory comment in the JXA references them by name, which is fine).
    expect(script).not.toMatch(/\bw\.close\(\)\s*;/);
    expect(script).not.toMatch(/\bt\.close\(\)\s*;/);
  });

  it("selects the target tab and forces frontmost before Cmd+W (race fix)", () => {
    const script = buildCloseTabScript("/dev/ttys042", false);
    const activateIdx = script.search(/terminal\.activate\(\)/);
    const selectedIdx = script.search(/\.selected\s*=\s*true/);
    const delayIdx = script.search(/delay\(\s*0\.[1-9]/);
    const keystrokeIdx = script.search(/keystroke\(\s*"w"/);
    expect(activateIdx).toBeGreaterThanOrEqual(0);
    expect(selectedIdx).toBeGreaterThanOrEqual(0);
    expect(delayIdx).toBeGreaterThanOrEqual(0);
    expect(keystrokeIdx).toBeGreaterThanOrEqual(0);
    // Order: activate → selected → delay → Cmd+W
    expect(activateIdx).toBeLessThan(selectedIdx);
    expect(selectedIdx).toBeLessThan(delayIdx);
    expect(delayIdx).toBeLessThan(keystrokeIdx);
  });
});
