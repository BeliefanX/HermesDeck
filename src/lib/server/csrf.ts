import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './auth';

/**
 * Same-origin guard for state-changing endpoints.
 *
 * We compare the request's `Origin` (or, if absent, `Referer`) host against an
 * explicit allowlist:
 *   - `HERMESDECK_PUBLIC_ORIGIN` — set in production behind a reverse proxy
 *     (e.g. https://deck.example.com). Comma-separated for multi-host setups.
 *   - localhost / 127.0.0.1 / ::1 — always allowed for dev convenience.
 *
 * We deliberately do NOT mirror the request's `Host` / `X-Forwarded-Host`
 * header: those are client-controllable when there's no proxy stripping them
 * and a malicious LAN actor could DNS-rebind to forge same-origin status.
 */
function parseAllowedHosts(): Set<string> {
  const env = process.env.HERMESDECK_PUBLIC_ORIGIN || '';
  const out = new Set<string>(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
  for (const part of env.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
      out.add(u.host.toLowerCase());
    } catch {
      out.add(trimmed.toLowerCase());
    }
  }
  return out;
}

// RFC1918 + link-local + loopback. Used in development to permit phones / other
// LAN devices without forcing the operator to enumerate IPs in HERMESDECK_PUBLIC_ORIGIN.
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1]!, b = +m[2]!;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}

function hostMatchesAllowed(host: string, allowed: Set<string>): boolean {
  const h = host.toLowerCase();
  if (allowed.has(h)) return true;
  // Allow host:port pairs where the bare host matches (dev convenience).
  const bare = h.includes(':') ? h.split(':')[0]! : h;
  if (bare && allowed.has(bare)) return true;
  // In development, accept any private-network IPv4 — phones / iPads on the
  // same Wi-Fi need to POST to the dev server, and the operator should not
  // have to enumerate every host.
  if (process.env.NODE_ENV !== 'production' && isPrivateIPv4(bare)) return true;
  return false;
}

export function isSameOrigin(req: NextRequest | Request): boolean {
  const headers = (req as Request).headers;
  const origin = headers.get('origin');
  const referer = headers.get('referer');
  const allowed = parseAllowedHosts();

  if (origin) {
    try {
      const u = new URL(origin);
      return hostMatchesAllowed(u.host, allowed);
    } catch {
      return false;
    }
  }
  if (referer) {
    try {
      const u = new URL(referer);
      return hostMatchesAllowed(u.host, allowed);
    } catch {
      return false;
    }
  }
  // Neither Origin nor Referer is present — block by default. Browsers always
  // send at least one for cross-site POST/PATCH/DELETE; same-origin fetches in
  // any modern browser also include Origin.
  return false;
}

/**
 * Re-check the session cookie at the route handler. Middleware already does
 * this for the matched routes, but defending in depth keeps a future
 * matcher-tweak from accidentally exposing a sensitive endpoint.
 */
export function requireAuth(req: NextRequest | Request): { ok: true } | { ok: false; response: NextResponse } {
  const cookieHeader = req.headers.get('cookie') || '';
  const m = cookieHeader.split(/; */).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const token = m ? decodeURIComponent(m.slice(SESSION_COOKIE.length + 1)) : undefined;
  const result = verifySessionToken(token);
  if (!result.ok) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 }) };
  }
  return { ok: true };
}

/**
 * Enforce both auth + same-origin for state-changing routes. Returns a
 * `NextResponse` to short-circuit when the check fails.
 */
export function guardMutating(req: NextRequest | Request): { ok: true } | { ok: false; response: NextResponse } {
  const auth = requireAuth(req);
  if (!auth.ok) return auth;
  if (!isSameOrigin(req)) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 }) };
  }
  return { ok: true };
}

export function guardRequestBody(
  req: NextRequest | Request,
  opts: { contentTypes: string[]; maxBytes: number },
): { ok: true } | { ok: false; response: NextResponse } {
  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  if (!opts.contentTypes.some((t) => contentType.startsWith(t.toLowerCase()))) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Unsupported Content-Type.' }, { status: 415 }) };
  }
  const len = req.headers.get('content-length');
  if (len) {
    const n = Number(len);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, response: NextResponse.json({ ok: false, error: 'Invalid Content-Length.' }, { status: 400 }) };
    }
    if (n > opts.maxBytes) {
      return { ok: false, response: NextResponse.json({ ok: false, error: 'Request body too large.', limit: opts.maxBytes }, { status: 413 }) };
    }
  }
  return { ok: true };
}

export async function readLimitedJsonText(
  req: NextRequest | Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  const body = (req as Request).body;
  if (!body) return { ok: true, text: '' };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, response: NextResponse.json({ ok: false, error: 'Request body too large.', limit: maxBytes }, { status: 413 }) };
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { ok: true, text: chunks.join('') };
  } catch {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 }) };
  }
}

export async function readLimitedBody(
  req: NextRequest | Request,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; response: NextResponse }> {
  const body = (req as Request).body;
  if (!body) return { ok: true, bytes: new Uint8Array() };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, response: NextResponse.json({ ok: false, error: 'Request body too large.', limit: maxBytes }, { status: 413 }) };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 }) };
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: out };
}

export async function readLimitedFormData(
  req: NextRequest | Request,
  maxBytes: number,
): Promise<{ ok: true; formData: FormData } | { ok: false; response: NextResponse }> {
  const bodyResult = await readLimitedBody(req, maxBytes);
  if (!bodyResult.ok) return bodyResult;
  try {
    const cloned = new Request('http://hermesdeck.local/upload', {
      method: 'POST',
      headers: { 'content-type': req.headers.get('content-type') || '' },
      body: bodyResult.bytes,
    });
    return { ok: true, formData: await cloned.formData() };
  } catch {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Invalid multipart/form-data body.' }, { status: 400 }) };
  }
}

export async function readLimitedJson<T = unknown>(
  req: NextRequest | Request,
  maxBytes: number,
  fallback?: T,
): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  const textResult = await readLimitedJsonText(req, maxBytes);
  if (!textResult.ok) return textResult;
  if (!textResult.text.trim()) return { ok: true, value: fallback as T };
  try {
    return { ok: true, value: JSON.parse(textResult.text) as T };
  } catch {
    if (fallback !== undefined) return { ok: true, value: fallback };
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 }) };
  }
}
