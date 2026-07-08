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

function readHermesEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const text = readFileSync(path, 'utf8');
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

export function defaultHermesRoot(): string {
  const envHome = process.env.HERMES_HOME?.trim();
  if (!envHome) return join(homedir(), '.hermes');
  const normalized = envHome.replace(/\\+/g, '/').replace(/\/+$/, '');
  const marker = '/profiles/';
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0 && normalized.slice(idx + marker.length) && !normalized.slice(idx + marker.length).includes('/')) {
    return envHome.slice(0, idx);
  }
  return envHome;
}

function profileHermesHome(profileId: string): string {
  const root = defaultHermesRoot();
  return profileId === 'default' ? root : join(root, 'profiles', profileId);
}

function readHermesEnv(profileId = 'default'): Record<string, string> {
  return readHermesEnvFile(join(profileHermesHome(profileId), '.env'));
}

export const hermesEnv = readHermesEnv();
const defaultApiPort = hermesEnv.API_SERVER_PORT || hermesEnv.HERMES_API_SERVER_PORT || '8642';

export const HERMES_API_BASE = process.env.HERMES_API_BASE || hermesEnv.HERMES_API_BASE || `http://127.0.0.1:${defaultApiPort}`;

function localConnectHostFromEnv(env: Record<string, string>): string {
  const host = (env.API_SERVER_HOST || env.HERMES_API_SERVER_HOST || '').trim();
  // API_SERVER_HOST is a bind address. For wildcard binds, connect via loopback.
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1';
  return host;
}

function apiBaseFromEnv(env: Record<string, string>, profileId: string): string | null {
  if (profileId !== 'default' && /^(?:0|false|no)$/i.test((env.API_SERVER_ENABLED || '').trim())) return null;
  const explicit = env.HERMES_API_BASE || env.HERMES_API_SERVER_BASE;
  if (explicit) return explicit;
  const port = env.API_SERVER_PORT || env.HERMES_API_SERVER_PORT;
  if (port) return `http://${localConnectHostFromEnv(env)}:${port}`;
  return profileId === 'default' ? `http://${localConnectHostFromEnv(hermesEnv)}:${defaultApiPort}` : null;
}

export function getHermesApiBase(profileId = 'default'): string | null {
  if (!PROFILE_ID_RE.test(profileId)) return null;
  if (profileId === 'default') return HERMES_API_BASE;
  const env = readHermesEnv(profileId);
  return apiBaseFromEnv(env, profileId);
}

export function apiHeaders(profileId = 'default'): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const env = profileId === 'default' ? hermesEnv : readHermesEnv(profileId);
  const key = profileId === 'default'
    ? (process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || env.HERMES_API_KEY || env.API_SERVER_KEY)
    : (env.HERMES_API_KEY || env.API_SERVER_KEY);
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

export function normalizedApiBase(base: string): string | null {
  try {
    const url = new URL(base);
    const host = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase()) ? 'loopback' : url.hostname.toLowerCase();
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${host}:${port}${path}`;
  } catch {
    return base.replace(/\/+$/, '');
  }
}

export function hasDedicatedProfileRouting(profileId: string): boolean {
  if (!profileId || profileId === 'default') return false;
  const profileBase = getHermesApiBase(profileId);
  const defaultBase = getHermesApiBase('default');
  if (!profileBase || !defaultBase) return false;
  if (normalizedApiBase(profileBase) !== normalizedApiBase(defaultBase)) return true;
  const profileAuth = apiHeaders(profileId).Authorization;
  const defaultAuth = apiHeaders('default').Authorization;
  return Boolean(profileAuth && defaultAuth && profileAuth !== defaultAuth);
}

export async function hermesApiGet<T>(path: string, timeoutMs = 5000, profileId = 'default'): Promise<T> {
  const apiBase = getHermesApiBase(profileId);
  if (!apiBase) {
    throw new Error(`Hermes Agent API GET ${path} failed: profile '${profileId}' has no configured API server base`);
  }
  const base = apiBase.replace(/\/+$/, '');
  const response = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
    cache: 'no-store',
    headers: apiHeaders(profileId),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const detail = text ? `: ${redactSecrets(text).slice(0, 240)}` : '';
    throw new Error(`Hermes Agent API GET ${path} failed with ${response.status}${detail}`);
  }
  return response.json() as Promise<T>;
}

export async function hermesApiRequest<T>(method: string, path: string, body?: unknown, timeoutMs = 5000, profileId = 'default'): Promise<T> {
  const apiBase = getHermesApiBase(profileId);
  if (!apiBase) {
    throw new Error(`Hermes Agent API ${method} ${path} failed: profile '${profileId}' has no configured API server base`);
  }
  const base = apiBase.replace(/\/+$/, '');
  const response = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
    method,
    cache: 'no-store',
    headers: apiHeaders(profileId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const detail = text ? `: ${redactSecrets(text).slice(0, 240)}` : '';
    throw new Error(`Hermes Agent API ${method} ${path} failed with ${response.status}${detail}`);
  }
  if (response.status === 204) return { ok: true } as T;
  return response.json() as Promise<T>;
}

export async function hermesApiDelete<T>(path: string, timeoutMs = 5000, profileId = 'default'): Promise<T> {
  return hermesApiRequest<T>('DELETE', path, undefined, timeoutMs, profileId);
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
