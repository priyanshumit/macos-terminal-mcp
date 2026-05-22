import { spawn } from "node:child_process";

export class OsascriptError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number,
    public readonly timedOut = false,
  ) {
    super(message);
    this.name = "OsascriptError";
  }
}

export interface RunJxaOptions {
  /** Hard timeout in milliseconds. On expiry the child is SIGKILL'd and the promise rejects with OsascriptError {timedOut: true}. Default 30000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function runJxa(script: string, options: RunJxaOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-l", "JavaScript"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(
        new OsascriptError(
          `osascript timed out after ${timeoutMs}ms`,
          stderr.trim(),
          -1,
          true,
        ),
      );
    }, timeoutMs);

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
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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

export async function runJxaJson<T>(
  script: string,
  options: RunJxaOptions = {},
): Promise<T> {
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
