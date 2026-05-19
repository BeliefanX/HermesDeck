import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Shared Python execution helper for the BFF.
 *
 * Wraps `execFile('python3', ['-c', script])` with sane defaults:
 * - 10MB stdout buffer (default node 1MB silently truncates large session
 *   histories; we'd rather get a structured failure than a corrupted JSON
 *   parse + empty array).
 * - Default 12s timeout — every caller can override.
 * - JSON.parse with a typed result; on parse/exec failure we return a
 *   structured `{ ok: false, error }` so callers can choose between
 *   surfacing the error or falling back.
 *
 * Callers should distinguish "empty data" from "failed to fetch": don't
 * blanket-return `[]` on `ok:false` — propagate to the route handler so the
 * UI can show a real error instead of an empty page.
 */
export type PyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface RunPythonOptions {
  bin?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  // Partial because Next's NodeJS.ProcessEnv augmentation requires NODE_ENV;
  // callers passing a couple of vars to merge should not have to repeat it.
  env?: Partial<NodeJS.ProcessEnv>;
}

export async function runPython<T>(script: string, opts: RunPythonOptions = {}): Promise<PyResult<T>> {
  const bin = opts.bin || 'python3';
  const timeout = opts.timeoutMs ?? 12_000;
  const maxBuffer = opts.maxBuffer ?? 10 * 1024 * 1024;
  // Always merge caller env into process.env — the previous behavior of
  // *replacing* process.env when opts.env was set silently broke PATH/HOME for
  // anything but the most trivial scripts. Callers expressing "extra env"
  // should never have to repeat existing values.
  const childEnv: NodeJS.ProcessEnv = opts.env ? ({ ...process.env, ...opts.env } as NodeJS.ProcessEnv) : process.env;
  try {
    const { stdout } = await execFileAsync(bin, ['-c', script], {
      timeout,
      maxBuffer,
      env: childEnv,
    });
    try {
      return { ok: true, value: JSON.parse(stdout) as T };
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return { ok: false, error: `python_parse_failed: ${msg}` };
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: number | string };
    if (e.killed || e.signal === 'SIGTERM' || e.signal === 'SIGKILL') {
      return { ok: false, error: 'python_timeout' };
    }
    if (e.code === 'ENOENT') {
      return { ok: false, error: 'python_not_found' };
    }
    if (typeof e.message === 'string' && e.message.includes('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) {
      return { ok: false, error: `python_output_too_large (max=${maxBuffer} bytes)` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.split('\n')[0]!.slice(0, 240) };
  }
}

/** Convenience for callers that want a fallback value on failure. */
export async function runPythonOr<T>(script: string, fallback: T, opts: RunPythonOptions = {}): Promise<T> {
  const r = await runPython<T>(script, opts);
  if (r.ok) return r.value;
  // eslint-disable-next-line no-console
  console.warn('[runPython] failed:', r.error);
  return fallback;
}
