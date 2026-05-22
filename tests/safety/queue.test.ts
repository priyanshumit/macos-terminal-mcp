import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, getPending, listPending, resolvePending } from "../../src/safety/queue.js";

describe("queue: enqueue + resolve", () => {
  it("makes the entry visible via listPending", async () => {
    const { id, promise } = enqueue({
      tty: "/dev/ttys999",
      command: "test cmd",
    });
    try {
      expect(listPending().some((e) => e.id === id)).toBe(true);
      expect(getPending(id)?.command).toBe("test cmd");
    } finally {
      resolvePending(id, false, "queue");
      await promise;
    }
  });

  it("resolves the promise with approved=true via queue", async () => {
    const { id, promise } = enqueue({
      tty: "/dev/ttys999",
      command: "x",
    });
    resolvePending(id, true, "queue");
    const r = await promise;
    expect(r.approved).toBe(true);
    expect(r.source).toBe("queue");
  });

  it("resolves with approved=false via dialog", async () => {
    const { id, promise } = enqueue({
      tty: "/dev/ttys999",
      command: "x",
    });
    resolvePending(id, false, "dialog");
    const r = await promise;
    expect(r.approved).toBe(false);
    expect(r.source).toBe("dialog");
  });

  it("removes entry from listPending after resolution", async () => {
    const { id, promise } = enqueue({
      tty: "/dev/ttys999",
      command: "x",
    });
    resolvePending(id, true, "queue");
    await promise;
    expect(listPending().some((e) => e.id === id)).toBe(false);
  });

  it("returns false on second resolution attempt", async () => {
    const { id, promise } = enqueue({
      tty: "/dev/ttys999",
      command: "x",
    });
    expect(resolvePending(id, true, "queue")).toBe(true);
    await promise;
    expect(resolvePending(id, false, "queue")).toBe(false);
  });

  it("returns false for unknown ids", () => {
    expect(resolvePending("does-not-exist", true, "queue")).toBe(false);
  });

  it("carries reason on denial", async () => {
    const { id, promise } = enqueue({
      tty: "/dev/ttys999",
      command: "x",
    });
    resolvePending(id, false, "queue", "test reason");
    const r = await promise;
    expect(r.reason).toBe("test reason");
  });

  it("getPending returns matchedPattern + description when provided", async () => {
    const { id, promise } = enqueue({
      tty: "/dev/ttys999",
      command: "x",
      matchedPattern: "\\bfoo\\b",
      matchedDescription: "foo description",
    });
    const snap = getPending(id);
    expect(snap?.matchedPattern).toBe("\\bfoo\\b");
    expect(snap?.matchedDescription).toBe("foo description");
    resolvePending(id, false, "queue");
    await promise;
  });
});

describe("queue: expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-resolves with source=expired after the stale window", async () => {
    const { promise } = enqueue({
      tty: "/dev/ttys999",
      command: "will time out",
    });
    vi.advanceTimersByTime(10 * 60 * 1000 + 100);
    const r = await promise;
    expect(r.approved).toBe(false);
    expect(r.source).toBe("expired");
  });
});

describe("queue: ordering", () => {
  it("listPending sorts by createdAt ascending", async () => {
    const a = enqueue({ tty: "/dev/ttys001", command: "a" });
    // Small delay to ensure distinct createdAt
    await new Promise((r) => setTimeout(r, 5));
    const b = enqueue({ tty: "/dev/ttys002", command: "b" });

    const list = listPending().filter((e) => e.id === a.id || e.id === b.id);
    expect(list.map((e) => e.command)).toEqual(["a", "b"]);

    resolvePending(a.id, false, "queue");
    resolvePending(b.id, false, "queue");
    await a.promise;
    await b.promise;
  });
});
