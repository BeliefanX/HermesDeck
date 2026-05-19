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
