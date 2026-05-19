import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * HermesDeck auth: a single-user credential store with a signed-cookie session.
 *
 * Storage: ~/.hermesdeck/auth.json — readable only by the user (chmod 600).
 * First-run boot generates a random one-time password printed to stdout
 * instead of falling back to admin/admin.
 */

const AUTH_DIR = join(homedir(), '.hermesdeck');
const AUTH_FILE = join(AUTH_DIR, 'auth.json');

export const SESSION_COOKIE = 'hermesdeck_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_AFTER_MS = SESSION_TTL_MS / 2;

export const PASSWORD_MIN_LENGTH = 8;

type AuthRecord = {
  version: 1;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  sessionSecret: string;
  passwordVersion: number;
  // First-run flag — set when the record was auto-provisioned with a random
  // password. Cleared on the first successful change-password call.
  bootstrap?: boolean;
};

function ensureDir() {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
}

function hashPassword(password: string, salt: string): string {
  // scrypt with maxmem bumped to allow N=2^15. Sync is required here because
  // verifyPassword runs on the auth hot path; callers should add their own
  // rate limit (rateLimitCheck does this).
  return scryptSync(password, salt, 64, { N: 1 << 15, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

function writeAuth(record: AuthRecord) {
  ensureDir();
  writeFileSync(AUTH_FILE, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(AUTH_FILE, 0o600); } catch {}
}

function defaultRecord(): { record: AuthRecord; plaintext: string } {
  const salt = randomBytes(16).toString('hex');
  // 18-byte url-safe random token gives ~24-char password — strong enough that
  // a brief LAN exposure window is not a free takeover.
  const plaintext = randomBytes(18).toString('base64url');
  return {
    record: {
      version: 1,
      username: 'admin',
      passwordSalt: salt,
      passwordHash: hashPassword(plaintext, salt),
      sessionSecret: randomBytes(32).toString('hex'),
      passwordVersion: 1,
      bootstrap: true,
    },
    plaintext,
  };
}

let cached: AuthRecord | null = null;
let cachedMtimeMs = 0;
let printedBootstrapBanner = false;
// Serializes first-boot init so two concurrent requests don't each generate a
// different bootstrap password and race writeAuth().
let firstBootInProgress = false;

function currentMtimeMs(): number {
  try { return statSync(AUTH_FILE).mtimeMs; } catch { return 0; }
}

function maybeAnnounceBootstrap(plaintext: string) {
  if (printedBootstrapBanner) return;
  printedBootstrapBanner = true;
  const banner = [
    '',
    '═══════════════════════════════════════════════════════',
    ' HermesDeck first-run bootstrap',
    ` Username: admin`,
    ` Password: ${plaintext}`,
    '',
    ' Sign in once and change the password from Settings.',
    ' This banner will not be shown again.',
    '═══════════════════════════════════════════════════════',
    '',
  ].join('\n');
  // eslint-disable-next-line no-console
  console.log(banner);
}

export function readAuth(): AuthRecord {
  const mtime = currentMtimeMs();
  if (cached && mtime && mtime === cachedMtimeMs) return cached;
  try {
    if (existsSync(AUTH_FILE)) {
      const raw = JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as Partial<AuthRecord>;
      if (
        raw && raw.version === 1 &&
        typeof raw.username === 'string' &&
        typeof raw.passwordSalt === 'string' &&
        typeof raw.passwordHash === 'string' &&
        typeof raw.sessionSecret === 'string'
      ) {
        cached = {
          version: 1,
          username: raw.username,
          passwordSalt: raw.passwordSalt,
          passwordHash: raw.passwordHash,
          sessionSecret: raw.sessionSecret,
          passwordVersion: typeof raw.passwordVersion === 'number' ? raw.passwordVersion : 1,
          bootstrap: raw.bootstrap === true ? true : undefined,
        };
        cachedMtimeMs = mtime;
        return cached;
      }
    }
  } catch {}
  // First boot — only one caller proceeds with seed generation; the rest spin
  // briefly and re-read the freshly written file. Without this lock, two
  // concurrent first requests would each generate their own bootstrap password
  // and one would silently clobber the other after the printed banner.
  if (firstBootInProgress) {
    const start = Date.now();
    while (firstBootInProgress && Date.now() - start < 5_000) {
      // Busy-wait is acceptable: this branch only runs once per process.
    }
    if (cached) return cached;
  }
  firstBootInProgress = true;
  try {
    // Re-check after acquiring the lock in case another path wrote it.
    if (existsSync(AUTH_FILE)) {
      try {
        const raw = JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as AuthRecord;
        if (raw && raw.version === 1) {
          cached = raw;
          cachedMtimeMs = currentMtimeMs();
          return cached;
        }
      } catch {}
    }
    const seeded = defaultRecord();
    cached = seeded.record;
    writeAuth(cached);
    cachedMtimeMs = currentMtimeMs();
    maybeAnnounceBootstrap(seeded.plaintext);
    return cached;
  } finally {
    firstBootInProgress = false;
  }
}

function saveAuth(next: AuthRecord) {
  cached = next;
  writeAuth(next);
  cachedMtimeMs = currentMtimeMs();
}

export function getUsername(): string {
  return readAuth().username;
}

export function isBootstrapPassword(): boolean {
  return readAuth().bootstrap === true;
}

export function verifyPassword(password: string): boolean {
  const rec = readAuth();
  const expected = Buffer.from(rec.passwordHash, 'hex');
  // Always run scrypt — even on empty input — so the timing of a wrong-username
  // login matches the timing of a wrong-password login. Without this an
  // attacker could enumerate valid usernames.
  let actual: Buffer;
  try { actual = Buffer.from(hashPassword(password || '', rec.passwordSalt), 'hex'); }
  catch { actual = Buffer.alloc(expected.length); }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function updateUsername(nextUsername: string): { ok: true } | { ok: false; error: string } {
  const trimmed = nextUsername.trim();
  if (trimmed.length < 1 || trimmed.length > 64) return { ok: false, error: 'Username must be 1–64 characters.' };
  if (!/^[A-Za-z0-9_.\-@]+$/.test(trimmed)) return { ok: false, error: 'Username may only contain letters, digits, and _.-@' };
  const rec = readAuth();
  saveAuth({ ...rec, username: trimmed });
  return { ok: true };
}

export function updatePassword(currentPassword: string, nextPassword: string): { ok: true } | { ok: false; error: string } {
  if (!verifyPassword(currentPassword)) return { ok: false, error: 'Current password is incorrect.' };
  if (typeof nextPassword !== 'string' || nextPassword.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `New password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (nextPassword.length > 256) return { ok: false, error: 'New password is too long.' };
  const rec = readAuth();
  const salt = randomBytes(16).toString('hex');
  saveAuth({
    ...rec,
    passwordSalt: salt,
    passwordHash: hashPassword(nextPassword, salt),
    passwordVersion: rec.passwordVersion + 1,
    bootstrap: undefined,
  });
  return { ok: true };
}

// --- Login rate limit ------------------------------------------------------
//
// Bounded LRU keyed on remote IP + username. Cap is hard so that a flood of
// distinct rotated usernames cannot grow the map without bound. We evict the
// least-recently-used entry once `MAX_BUCKETS` is reached.

type Bucket = { count: number; firstAttemptAt: number; lockedUntil: number; lastTouchedAt: number };
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX_FAILURES = 6;
const RATE_LOCK_MS = 15 * 60 * 1000;
const MAX_BUCKETS = 1024;
const buckets = new Map<string, Bucket>();

function pruneBuckets(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  // Drop expired entries first.
  for (const [k, b] of buckets) {
    if (b.lockedUntil <= now && now - b.firstAttemptAt > RATE_WINDOW_MS) buckets.delete(k);
  }
  // If still oversized, evict oldest by lastTouchedAt.
  if (buckets.size >= MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt);
    const toEvict = buckets.size - Math.floor(MAX_BUCKETS * 0.9);
    for (let i = 0; i < toEvict && i < sorted.length; i++) buckets.delete(sorted[i]![0]);
  }
}

export function rateLimitCheck(key: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfterMs: number } {
  pruneBuckets(now);
  const b = buckets.get(key);
  if (!b) return { allowed: true };
  if (b.lockedUntil > now) return { allowed: false, retryAfterMs: b.lockedUntil - now };
  return { allowed: true };
}

export function rateLimitRecordFailure(key: string, now = Date.now()): { lockedUntil: number; remaining: number } {
  pruneBuckets(now);
  let b = buckets.get(key);
  if (!b || now - b.firstAttemptAt > RATE_WINDOW_MS) {
    b = { count: 0, firstAttemptAt: now, lockedUntil: 0, lastTouchedAt: now };
  }
  b.count += 1;
  b.lastTouchedAt = now;
  if (b.count >= RATE_MAX_FAILURES) {
    b.lockedUntil = now + RATE_LOCK_MS;
  }
  buckets.set(key, b);
  return { lockedUntil: b.lockedUntil, remaining: Math.max(0, RATE_MAX_FAILURES - b.count) };
}

export function rateLimitReset(key: string) {
  buckets.delete(key);
}

// --- Cookie helpers --------------------------------------------------------
//
// `secure` is true on https, false on http. Setting `secure` on an http
// connection causes the browser to silently drop the cookie — the user
// "logs in" but every subsequent request lands without it, and the proxy
// keeps redirecting back to /login.
//
// In production, deployments behind a TLS-terminating proxy may pass `http:`
// upstream; the operator must set HERMESDECK_FORCE_SECURE_COOKIE=1 to
// re-enable Secure regardless of the protocol seen by Next.
export function cookieSecureFor(req: { nextUrl: URL } | { url: string }): boolean {
  if (process.env.HERMESDECK_FORCE_SECURE_COOKIE === '1') return true;
  try {
    const url = 'nextUrl' in req ? req.nextUrl : new URL(req.url);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

// --- Session token (signed cookie) -----------------------------------------

type Payload = { u: string; pv: number; iat: number; exp: number };

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function sign(payload: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(payload).digest());
}

export function issueSessionToken(now = Date.now(), ttlMs = SESSION_TTL_MS): string {
  const rec = readAuth();
  const payload: Payload = { u: rec.username, pv: rec.passwordVersion, iat: now, exp: now + ttlMs };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = sign(body, rec.sessionSecret);
  return `${body}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: Payload; shouldRefresh: boolean }
  | { ok: false };

export function verifySessionToken(token: string | undefined | null, now = Date.now()): VerifyResult {
  if (!token || typeof token !== 'string' || !token.includes('.')) return { ok: false };
  const [body, sig] = token.split('.', 2);
  if (!body || !sig) return { ok: false };
  const rec = readAuth();
  const expectedSig = sign(body, rec.sessionSecret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  let payload: Payload;
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')) as Payload; }
  catch { return { ok: false }; }
  if (payload.u !== rec.username) return { ok: false };
  if (payload.pv !== rec.passwordVersion) return { ok: false };
  if (typeof payload.exp !== 'number' || payload.exp <= now) return { ok: false };
  const shouldRefresh = (now - (payload.iat || 0)) > REFRESH_AFTER_MS;
  return { ok: true, payload, shouldRefresh };
}
