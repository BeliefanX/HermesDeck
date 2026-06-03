import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const execFileAsync = promisify(execFile);
export const startedAt = Date.now();

export const PROFILE_ID_RE = /^[\w.-]{1,64}$/;

type CacheEntry<T> = { at: number; value: T };
export function makeCache<T>(ttlMs: number, fetcher: () => Promise<T>): () => Promise<T> {
  const NEG_TTL_MS = Math.min(1500, Math.floor(ttlMs / 4));
  let cached: CacheEntry<T> | null = null;
  let negativeAt = 0;
  let lastError: unknown = null;
  let inflight: Promise<T> | null = null;
  return async () => {
    const now = Date.now();
    if (cached && now - cached.at < ttlMs) return cached.value;
    if (negativeAt && now - negativeAt < NEG_TTL_MS) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const value = await fetcher();
        cached = { at: Date.now(), value };
        negativeAt = 0;
        lastError = null;
        return value;
      } catch (err) {
        negativeAt = Date.now();
        lastError = err;
        throw err;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}

export function makeKeyedCache<K extends string, T>(
  ttlMs: number,
  fetcher: (key: K) => Promise<T>,
  maxKeys = 64,
): (key: K) => Promise<T> {
  // Bounded LRU: keys are caller-influenceable (e.g. profile ids), so the map
  // must not grow without limit. Map preserves insertion order — re-inserting
  // on access keeps the most-recently-used keys at the tail.
  const cells = new Map<K, () => Promise<T>>();
  return (key: K) => {
    let cell = cells.get(key);
    if (cell) {
      cells.delete(key);
      cells.set(key, cell);
    } else {
      cell = makeCache(ttlMs, () => fetcher(key));
      cells.set(key, cell);
      if (cells.size > maxKeys) {
        const oldest = cells.keys().next().value;
        if (oldest !== undefined) cells.delete(oldest);
      }
    }
    return cell();
  };
}

function readHermesEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const text = readFileSync(join(homedir(), '.hermes', '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      env[key] = val;
    }
  } catch {}
  return env;
}

export const hermesEnv = readHermesEnv();
const defaultApiPort = hermesEnv.API_SERVER_PORT || hermesEnv.HERMES_API_SERVER_PORT || '8642';

export const HERMES_API_BASE = process.env.HERMES_API_BASE || hermesEnv.HERMES_API_BASE || `http://127.0.0.1:${defaultApiPort}`;
export const HERMES_DASHBOARD_BASE = process.env.HERMES_DASHBOARD_BASE || hermesEnv.HERMES_DASHBOARD_BASE || 'http://127.0.0.1:9120';

export function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || hermesEnv.HERMES_API_KEY || hermesEnv.API_SERVER_KEY;
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

export async function hermesApiGet<T>(path: string, timeoutMs = 5000): Promise<T> {
  const base = HERMES_API_BASE.replace(/\/+$/, '');
  const response = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
    cache: 'no-store',
    headers: apiHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const detail = text ? `: ${redactSecrets(text).slice(0, 240)}` : '';
    throw new Error(`Hermes Agent API GET ${path} failed with ${response.status}${detail}`);
  }
  return response.json() as Promise<T>;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|access[_-]?key)\s*[=:]\s*)['"]?[^\s'",}]+/gi, '$1[REDACTED]')
    .replace(/(["'](?:api[_-]?key|token|secret|password|access[_-]?key)["']\s*:\s*)["'][^"']+["']/gi, '$1"[REDACTED]"')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .replace(/\bxai-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .replace(/\bgsk_[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .replace(/\bgh[posur]_[A-Za-z0-9]{20,}\b/g, '[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

// Combine multiple AbortSignals with a Node-version-safe fallback. AbortSignal.any
// requires Node 20.3+; we polyfill it for older runtimes rather than crashing.
export function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort((s as AbortSignal & { reason?: unknown }).reason);
      return ctrl.signal;
    }
    s.addEventListener('abort', () => ctrl.abort((s as AbortSignal & { reason?: unknown }).reason), { once: true });
  }
  return ctrl.signal;
}

export function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown): void {
  // controller.enqueue throws if called after close; that's fine for the
  // happy path, but during cancellation the upstream loop may race a
  // close — wrap defensively so a stream tear-down doesn't surface as an
  // unhandled rejection in the route handler.
  try {
    controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  } catch { /* controller already closed */ }
}
