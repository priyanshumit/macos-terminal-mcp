import { randomUUID } from "node:crypto";

export type ResolutionSource = "dialog" | "queue" | "expired";

export interface PendingResolution {
  approved: boolean;
  source: ResolutionSource;
  reason?: string;
}

interface PendingEntry {
  id: string;
  tty: string;
  command: string;
  matchedPattern?: string;
  matchedDescription?: string;
  createdAt: number;
  expiresAt: number;
  resolve: (r: PendingResolution) => void;
  timer: NodeJS.Timeout;
}

const STALE_MS = 10 * 60 * 1000;
const pending = new Map<string, PendingEntry>();

export interface EnqueueInput {
  tty: string;
  command: string;
  matchedPattern?: string;
  matchedDescription?: string;
}

export function enqueue(input: EnqueueInput): {
  id: string;
  promise: Promise<PendingResolution>;
} {
  const id = randomUUID();
  const now = Date.now();
  const expiresAt = now + STALE_MS;
  const promise = new Promise<PendingResolution>((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id);
      if (entry) {
        pending.delete(id);
        entry.resolve({ approved: false, source: "expired" });
      }
    }, STALE_MS);
    pending.set(id, {
      id,
      tty: input.tty,
      command: input.command,
      matchedPattern: input.matchedPattern,
      matchedDescription: input.matchedDescription,
      createdAt: now,
      expiresAt,
      resolve,
      timer,
    });
  });
  return { id, promise };
}

export function resolvePending(
  id: string,
  approved: boolean,
  source: ResolutionSource,
  reason?: string,
): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve({ approved, source, ...(reason ? { reason } : {}) });
  return true;
}

export interface PendingSnapshot {
  id: string;
  tty: string;
  command: string;
  matchedPattern?: string;
  matchedDescription?: string;
  createdAt: number;
  expiresAt: number;
  ageMs: number;
}

export function listPending(): PendingSnapshot[] {
  const now = Date.now();
  return Array.from(pending.values())
    .map((e) => ({
      id: e.id,
      tty: e.tty,
      command: e.command,
      ...(e.matchedPattern ? { matchedPattern: e.matchedPattern } : {}),
      ...(e.matchedDescription ? { matchedDescription: e.matchedDescription } : {}),
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
      ageMs: now - e.createdAt,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function getPending(id: string): PendingSnapshot | undefined {
  const e = pending.get(id);
  if (!e) return undefined;
  const now = Date.now();
  return {
    id: e.id,
    tty: e.tty,
    command: e.command,
    ...(e.matchedPattern ? { matchedPattern: e.matchedPattern } : {}),
    ...(e.matchedDescription ? { matchedDescription: e.matchedDescription } : {}),
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
    ageMs: now - e.createdAt,
  };
}
