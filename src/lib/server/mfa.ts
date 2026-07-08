import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { DeckPasskey, DeckUser } from '@/lib/server/auth';
import { addPasskeyToUser, getDeckUserById, updatePasskeyCounter } from '@/lib/server/auth';

const TOTP_STEP_MS = 30_000;
const TOTP_DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 512;

type Pending = { userId: string; challenge: string; createdAt: number; kind: 'password_mfa' | 'webauthn_login_challenge' | 'webauthn_register_challenge'; name?: string };
const pending = new Map<string, Pending>(); // ponytail: in-memory challenge TTL; use durable store if multi-process Deck matters.

export function userMfaFactors(user: DeckUser): { totp: boolean; passkey: boolean } {
  return { totp: user.mfa?.totp?.enabled === true, passkey: (user.mfa?.passkeys?.length || 0) > 0 };
}

export function hasMfa(user: DeckUser): boolean {
  const f = userMfaFactors(user);
  return f.totp || f.passkey;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(user: DeckUser, secret: string, issuer = 'HermesDeck'): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${user.username}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=30`;
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const buf = Buffer.from(clean);
  for (let w = -1; w <= 1; w++) {
    const expected = Buffer.from(totpAt(secret, Math.floor(now / TOTP_STEP_MS) + w));
    if (buf.length === expected.length && timingSafeEqual(buf, expected)) return true;
  }
  return false;
}

export function makeMfaToken(userId: string): string {
  return storePending({ userId, kind: 'password_mfa' });
}

export function consumeMfaToken(token: string): DeckUser | null {
  const item = takePending(token, 'password_mfa');
  return item ? getDeckUserById(item.userId) : null;
}

export function peekMfaToken(token: string): DeckUser | null {
  prunePending();
  const item = pending.get(token);
  if (!item || item.kind !== 'password_mfa') return null;
  return getDeckUserById(item.userId);
}

export async function makeRegistrationOptions(user: DeckUser, req: Request, name?: string) {
  const rp = rpInfo(req);
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.username,
    userDisplayName: user.displayName || user.username,
    userID: Buffer.from(user.id),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'discouraged', userVerification: 'preferred' },
    excludeCredentials: (user.mfa?.passkeys || []).map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransportFuture[] | undefined })),
  });
  const challengeId = storePending({ userId: user.id, kind: 'webauthn_register_challenge', challenge: options.challenge, name });
  return { options, challengeId };
}

export async function verifyRegistration(userId: string, challengeId: string, response: RegistrationResponseJSON, req: Request, name?: string) {
  const item = takePending(challengeId, 'webauthn_register_challenge');
  if (!item || item.userId !== userId) return { ok: false as const, error: 'Registration challenge expired.' };
  const rp = rpInfo(req);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: item.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
    requireUserVerification: false,
  });
  if (!result.verified) return { ok: false as const, error: 'Passkey registration failed.' };
  const c = result.registrationInfo.credential;
  const passkey: DeckPasskey = {
    id: c.id,
    publicKey: b64urlEncode(Buffer.from(c.publicKey)),
    counter: c.counter,
    transports: response.response.transports as AuthenticatorTransportFuture[] | undefined,
    name: (name || item.name || 'Passkey').slice(0, 80),
    createdAt: new Date().toISOString(),
  };
  addPasskeyToUser(userId, passkey);
  return { ok: true as const };
}

export async function makeAuthenticationOptions(user: DeckUser, req: Request) {
  const rp = rpInfo(req);
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: 'preferred',
    allowCredentials: (user.mfa?.passkeys || []).map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransportFuture[] | undefined })),
  });
  const challengeId = storePending({ userId: user.id, kind: 'webauthn_login_challenge', challenge: options.challenge });
  return { options, challengeId };
}

export async function verifyAuthentication(user: DeckUser, challengeId: string, response: AuthenticationResponseJSON, req: Request) {
  const item = takePending(challengeId, 'webauthn_login_challenge');
  if (!item || item.userId !== user.id) return { ok: false as const, error: 'Passkey challenge expired.' };
  const passkey = (user.mfa?.passkeys || []).find((p) => p.id === response.id);
  if (!passkey) return { ok: false as const, error: 'Unknown passkey.' };
  const rp = rpInfo(req);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: item.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
    credential: { id: passkey.id, publicKey: b64urlDecode(passkey.publicKey), counter: passkey.counter, transports: passkey.transports as AuthenticatorTransportFuture[] | undefined },
    requireUserVerification: false,
  });
  if (!result.verified) return { ok: false as const, error: 'Passkey verification failed.' };
  updatePasskeyCounter(user.id, passkey.id, result.authenticationInfo.newCounter);
  return { ok: true as const };
}

function storePending(input: Omit<Pending, 'challenge' | 'createdAt'> & { challenge?: string }): string {
  prunePending();
  const id = randomBytes(24).toString('base64url');
  pending.set(id, { ...input, challenge: input.challenge || randomBytes(24).toString('base64url'), createdAt: Date.now() });
  return id;
}

function takePending(id: string, kind: Pending['kind']): Pending | null {
  prunePending();
  const item = pending.get(id);
  if (!item || item.kind !== kind) return null;
  pending.delete(id);
  return item;
}

function prunePending() {
  const now = Date.now();
  for (const [id, item] of pending) if (now - item.createdAt > CHALLENGE_TTL_MS) pending.delete(id);
  if (pending.size > MAX_CHALLENGES) for (const id of [...pending.keys()].slice(0, pending.size - MAX_CHALLENGES)) pending.delete(id);
}

function rpInfo(req: Request) {
  const origin = process.env.HERMESDECK_WEBAUTHN_ORIGIN || new URL(req.url).origin;
  const host = new URL(origin).hostname;
  return {
    origin,
    id: process.env.HERMESDECK_WEBAUTHN_RP_ID || (host === '127.0.0.1' ? 'localhost' : host),
    name: process.env.HERMESDECK_WEBAUTHN_RP_NAME || 'HermesDeck',
  };
}

function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(value: string): Buffer {
  let bits = 0, acc = 0;
  const out: number[] = [];
  for (const ch of value.toUpperCase().replace(/=|\s/g, '')) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    acc = (acc << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | ((h[o + 1]! & 0xff) << 16) | ((h[o + 2]! & 0xff) << 8) | (h[o + 3]! & 0xff);
  return String(n % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}
function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, 'base64url');
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
