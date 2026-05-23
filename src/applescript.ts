import { spawn } from "node:child_process";

export class OsascriptError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number,
    public readonly timedOut = false,
    public readonly aborted = false,
  ) {
    super(message);
    this.name = "OsascriptError";
  }
}

export interface RunJxaOptions {
  /** Hard timeout in milliseconds. On expiry the child is SIGKILL'd and the promise rejects with OsascriptError {timedOut: true}. Default 30000. */
  timeoutMs?: number;
  /** Abort the in-flight osascript invocation. When the signal fires, the child is SIGKILL'd and the promise rejects with OsascriptError {aborted: true}. Useful for dismissing a confirmation dialog that's been resolved out-of-band by another path. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function runJxa(script: string, options: RunJxaOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    // Fast-path: already-aborted signal — don't even spawn.
    if (options.signal?.aborted) {
      reject(new OsascriptError("osascript aborted before launch", "", -1, false, true));
      return;
    }

    const proc = spawn("osascript", ["-l", "JavaScript"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      clearTimeout(timer);
      reject(new OsascriptError("osascript aborted", stderr.trim(), -1, false, true));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      options.signal?.removeEventListener("abort", onAbort);
      reject(
        new OsascriptError(`osascript timed out after ${timeoutMs}ms`, stderr.trim(), -1, true),
      );
    }, timeoutMs);

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (code === 0) {
        resolve(stdout.replace(/\n$/, ""));
      } else {
        reject(
          new OsascriptError(
            `osascript exited ${code}: ${stderr.trim()}`,
            stderr.trim(),
            code ?? -1,
          ),
        );
      }
    });
    proc.stdin.write(script);
    proc.stdin.end();
  });
}

export async function runJxaJson<T>(script: string, options: RunJxaOptions = {}): Promise<T> {
  const output = await runJxa(script, options);
  try {
    return JSON.parse(output) as T;
  } catch (err) {
    const preview = output.length > 500 ? `${output.slice(0, 500)}…` : output;
    throw new OsascriptError(
      `JXA stdout was not valid JSON: ${(err as Error).message}\nOutput: ${preview}`,
      output,
      -1,
    );
  }
}
