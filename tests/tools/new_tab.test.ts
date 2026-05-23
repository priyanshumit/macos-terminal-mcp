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

  // Regression: v0.5.0 shipped with `terminal.doScript("", { in: wins[0] })`
  // which silently no-ops on current macOS and returns the existing tab — the
  // tool would claim success but no new tab existed. The fix uses System Events
  // Cmd+T (or Cmd+N when no window exists) and diffs tab tty-sets before/after.
  it("uses System Events keystroke to create the tab, not doScript('')", async () => {
    mockedRunJxa.mockResolvedValue('{"tty":"/dev/ttys099","windowId":131200}');

    await newTabHandler();

    const script = (mockedRunJxa.mock.calls[0]?.[0] as string) ?? "";
    expect(script).toContain("System Events");
    expect(script).toContain("keystroke");
    expect(script).toContain("command down");
    // The broken approach must not reappear.
    expect(script).not.toMatch(/doScript\s*\(\s*""/);
  });

  it("snapshots tabs before+after to detect the actually-new tab", async () => {
    mockedRunJxa.mockResolvedValue('{"tty":"/dev/ttys099","windowId":131200}');

    await newTabHandler();

    const script = (mockedRunJxa.mock.calls[0]?.[0] as string) ?? "";
    // Before/after snapshot pattern: the script enumerates tabs twice and finds
    // the one that wasn't present before.
    expect(script).toMatch(/snapshotTabs|before|after/);
    expect(script).toMatch(/!\s*\(\s*\S+\s*in\s+before\s*\)/);
  });

  it("propagates the JXA error when no new tab appears (Accessibility missing)", async () => {
    mockedRunJxa.mockRejectedValue(
      new Error(
        "terminal_new_tab: no new tab appeared after Cmd+T. Accessibility permission may be missing — grant via System Settings → Privacy & Security → Accessibility.",
      ),
    );

    const result = await newTabHandler();

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/terminal_new_tab failed/);
    expect(text).toMatch(/Accessibility/);
  });

  // Regression: v0.5.2 known-issue — activate() returns before the window
  // server makes Terminal frontmost, so the keystroke can land on whichever
  // app was previously frontmost (opens new window instead of new tab). Fix
  // chain: insert a delay between activate() and the keystroke (v0.6.0), and
  // force-frontmost via System Events with branching warm/cold delays (v0.6.1).
  it("inserts a delay and forces frontmost before the keystroke", async () => {
    mockedRunJxa.mockResolvedValue('{"tty":"/dev/ttys099","windowId":131200}');

    await newTabHandler();

    const script = (mockedRunJxa.mock.calls[0]?.[0] as string) ?? "";
    const activateIdx = script.indexOf("terminal.activate()");
    const frontmostIdx = script.search(/applicationProcesses\["Terminal"\]\.frontmost\s*=\s*true/);
    const delayIdx = script.search(/delay\(\s*0\.[1-9]/);
    const keystrokeIdx = script.indexOf("systemEvents.keystroke");

    expect(activateIdx).toBeGreaterThan(-1);
    expect(frontmostIdx).toBeGreaterThan(activateIdx);
    expect(delayIdx).toBeGreaterThan(activateIdx);
    expect(keystrokeIdx).toBeGreaterThan(delayIdx);
  });

  // Regression for v0.6.1: cold-start when Terminal isn't running. The warm
  // path's 150ms delay was way too short — activate() must launch Terminal,
  // which takes >1s on most macs. Fix uses `terminal.running()` to branch
  // into a polling wait of up to ~3s for cold starts.
  it("handles cold start by polling for terminal.running()", async () => {
    mockedRunJxa.mockResolvedValue('{"tty":"/dev/ttys099","windowId":131200}');

    await newTabHandler();

    const script = (mockedRunJxa.mock.calls[0]?.[0] as string) ?? "";
    expect(script).toMatch(/terminal\.running\(\)/);
    expect(script).toMatch(/wasRunning/);
  });
});
