import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { OsascriptError, runJxa } from "../src/applescript.js";

const mockedSpawn = vi.mocked(spawn);

class FakeProc extends EventEmitter {
  public stdout: EventEmitter;
  public stderr: EventEmitter;
  public stdin = { write: vi.fn(), end: vi.fn() };
  public kill = vi.fn();
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
}

function spawnReturnsFake(): FakeProc {
  const proc = new FakeProc();
  mockedSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
  return proc;
}

beforeEach(() => {
  mockedSpawn.mockReset();
});

describe("runJxa AbortSignal", () => {
  it("rejects with aborted=true and never spawns when signal is pre-aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(runJxa("noop", { signal: ctrl.signal })).rejects.toMatchObject({
      aborted: true,
      timedOut: false,
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("kills the child with SIGKILL and rejects with aborted=true when aborted mid-flight", async () => {
    const proc = spawnReturnsFake();
    const ctrl = new AbortController();

    const promise = runJxa("noop", { signal: ctrl.signal });
    // Let the spawn happen + listeners attach.
    await new Promise((r) => setImmediate(r));
    ctrl.abort();

    await expect(promise).rejects.toMatchObject({
      aborted: true,
      timedOut: false,
    });
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("resolves normally when signal is never aborted", async () => {
    const proc = spawnReturnsFake();
    const ctrl = new AbortController();

    const promise = runJxa("noop", { signal: ctrl.signal });
    await new Promise((r) => setImmediate(r));
    proc.stdout.emit("data", Buffer.from("hello\n"));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("hello");
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("does not kill or throw when signal aborts AFTER the run already settled", async () => {
    const proc = spawnReturnsFake();
    const ctrl = new AbortController();

    const promise = runJxa("noop", { signal: ctrl.signal });
    await new Promise((r) => setImmediate(r));
    proc.stdout.emit("data", Buffer.from("done"));
    proc.emit("close", 0);
    await promise;

    // Aborting after close should be a no-op (listener was removed on settle).
    expect(() => ctrl.abort()).not.toThrow();
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("treats aborted distinctly from timedOut on OsascriptError", async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    try {
      await runJxa("noop", { signal: ctrl.signal });
      expect.fail("should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(OsascriptError);
      const e = err as OsascriptError;
      expect(e.aborted).toBe(true);
      expect(e.timedOut).toBe(false);
    }
  });
});
