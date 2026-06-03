import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * HermesDeck auth: local credential/RBAC store with signed-cookie sessions.
 *
 * Storage: ~/.hermesdeck/auth.json — directory 0700, file 0600.
 * First-run boot generates a random one-time password printed to stdout
 * instead of falling back to admin/admin.
 */

const AUTH_DIR = process.env.HERMESDECK_AUTH_DIR || join(homedir(), '.hermesdeck');
const AUTH_FILE = join(AUTH_DIR, 'auth.json');
const V1_BACKUP_FILE = join(AUTH_DIR, 'auth.json.v1.bak');

export const SESSION_COOKIE = 'hermesdeck_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_AFTER_MS = SESSION_TTL_MS / 2;

export const PASSWORD_MIN_LENGTH = 8;

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SALT_HEX_LENGTH = PASSWORD_SALT_BYTES * 2;
const PASSWORD_HASH_HEX_LENGTH = PASSWORD_HASH_BYTES * 2;
const HEX_PATTERN = /^[0-9a-f]+$/i;

export type DeckRole = 'super_admin' | 'admin' | 'user';
export type DeckUserStatus = 'pending' | 'active' | 'disabled' | 'rejected';

export type DeckModelPreference = {
  modelId?: string;
  modelProvider?: string;
  updatedAt: string;
};

export type DeckUserProfilePreferences = Record<string, DeckModelPreference>;

export type DeckUser = {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  role: DeckRole;
  status: DeckUserStatus;
  passwordSalt: string;
  passwordHash: string;
  passwordVersion: number;
  assignedProfileIds: string[];
  preferences: { profiles: DeckUserProfilePreferences };
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  disabledAt?: string;
  disabledBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  bootstrap?: boolean;
};

export type SafeDeckUserContext = {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  role: DeckRole;
  status: DeckUserStatus;
  assignedProfileIds: string[];
  capabilities: {
    canUseApp: boolean;
    canManageUsers: boolean;
    canApproveUsers: boolean;
    canUseTerminal: boolean;
    canManageOwnCredentials: boolean;
  };
};

export type SafeAdminDeckUser = SafeDeckUserContext & {
  immutable: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  disabledAt?: string;
  disabledBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
};

export type AdminUserPatch = {
  displayName?: unknown;
  email?: unknown;
  status?: unknown;
  role?: unknown;
};

export type AdminUserMutationResult =
  | { ok: true; user: SafeAdminDeckUser }
  | { ok: false; code: 'not_found' | 'forbidden' | 'invalid' | 'invalid_profile'; error: string };

export type RegisterPendingUserInput = {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
  email?: unknown;
};

export type RegisterPendingUserResult =
  | { ok: true; user: SafeDeckUserContext }
  | { ok: false; error: string; code: 'invalid' | 'duplicate' };

export type DeckAuthStore = {
  version: 2;
  sessionSecret: string;
  users: Record<string, DeckUser>;
  registrationsOpen: true;
  createdAt: string;
  updatedAt: string;
};

type AuthRecordV1 = {
  version: 1;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  sessionSecret: string;
  passwordVersion: number;
  bootstrap?: boolean;
};

export class AuthStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthStoreError';
  }
}

function ensureDir() {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(AUTH_DIR, 0o700); } catch {}
}

function fsyncDirIfPractical() {
  try {
    const fd = openSync(AUTH_DIR, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch {}
}

function hashPassword(password: string, salt: string): string {
  // scrypt with maxmem bumped to allow N=2^15. Sync is required here because
  // verifyPassword runs on the auth hot path; callers should add their own
  // rate limit (rateLimitCheck does this).
  return scryptSync(password, salt, 64, { N: 1 << 15, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

export function createPasswordRecord(password: string, passwordVersion = 1): Pick<DeckUser, 'passwordSalt' | 'passwordHash' | 'passwordVersion'> {
  const passwordSalt = randomBytes(PASSWORD_SALT_BYTES).toString('hex');
  return { passwordSalt, passwordHash: hashPassword(password, passwordSalt), passwordVersion };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 512;
}

function validUsername(username: unknown): username is string {
  return typeof username === 'string' && username.trim().length >= 1 && username.trim().length <= 64 && /^[A-Za-z0-9_.\-@]+$/.test(username.trim());
}

function validateRegistrationFields(input: RegisterPendingUserInput):
  | { ok: true; username: string; password: string; displayName?: string; email?: string }
  | { ok: false; error: string } {
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';

  if (!validUsername(username)) {
    return { ok: false, error: 'Username must be 1–64 characters and may only contain letters, digits, and _.-@' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > 256) return { ok: false, error: 'Password is too long.' };
  if (displayName.length > 120) return { ok: false, error: 'Display name is too long.' };
  if (email) {
    if (email.length > 254) return { ok: false, error: 'Email is too long.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Email must be a valid email address.' };
  }

  return {
    ok: true,
    username,
    password,
    displayName: displayName || undefined,
    email: email || undefined,
  };
}

function isExpectedHexMaterial(value: unknown, expectedLength: number): value is string {
  return typeof value === 'string' && value.length === expectedLength && HEX_PATTERN.test(value);
}

function validPasswordMaterial(salt: unknown, hash: unknown): salt is string {
  return isExpectedHexMaterial(salt, PASSWORD_SALT_HEX_LENGTH) && isExpectedHexMaterial(hash, PASSWORD_HASH_HEX_LENGTH);
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function validateRole(role: unknown): role is DeckRole {
  return role === 'super_admin' || role === 'admin' || role === 'user';
}

function validateStatus(status: unknown): status is DeckUserStatus {
  return status === 'pending' || status === 'active' || status === 'disabled' || status === 'rejected';
}

function validateProfiles(value: unknown): DeckUserProfilePreferences {
  if (!isPlainObject(value)) return {};
  const result: DeckUserProfilePreferences = {};
  for (const [profileId, pref] of Object.entries(value)) {
    if (typeof profileId !== 'string' || !profileId) continue;
    if (!isPlainObject(pref) || typeof pref.updatedAt !== 'string') continue;
    const modelId = parseOptionalString(pref.modelId);
    const modelProvider = parseOptionalString(pref.modelProvider);
    result[profileId] = {
      ...(modelId ? { modelId } : {}),
      ...(modelProvider ? { modelProvider } : {}),
      updatedAt: pref.updatedAt,
    };
  }
  return result;
}

function validateUser(raw: unknown, key: string): DeckUser {
  if (!isPlainObject(raw)) throw new AuthStoreError('Invalid v2 auth store: user record must be an object.');
  if (raw.id !== key || typeof raw.id !== 'string' || raw.id.length < 1 || raw.id.length > 128) {
    throw new AuthStoreError('Invalid v2 auth store: user id mismatch.');
  }
  if (!validUsername(raw.username)) throw new AuthStoreError('Invalid v2 auth store: invalid username.');
  if (!validateRole(raw.role)) throw new AuthStoreError('Invalid v2 auth store: invalid role.');
  if (!validateStatus(raw.status)) throw new AuthStoreError('Invalid v2 auth store: invalid status.');
  if (!validPasswordMaterial(raw.passwordSalt, raw.passwordHash)) throw new AuthStoreError('Invalid v2 auth store: invalid password material.');
  if (!Number.isInteger(raw.passwordVersion) || (raw.passwordVersion as number) < 1) {
    throw new AuthStoreError('Invalid v2 auth store: invalid password version.');
  }
  if (!Array.isArray(raw.assignedProfileIds) || raw.assignedProfileIds.some((id) => typeof id !== 'string')) {
    throw new AuthStoreError('Invalid v2 auth store: invalid profile assignments.');
  }
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') {
    throw new AuthStoreError('Invalid v2 auth store: missing user timestamps.');
  }
  const preferencesRaw = isPlainObject(raw.preferences) ? raw.preferences : {};
  const passwordVersion = raw.passwordVersion;
  if (typeof raw.passwordHash !== 'string' || typeof passwordVersion !== 'number') {
    throw new AuthStoreError('Invalid v2 auth store: invalid password material.');
  }
  return {
    id: raw.id,
    username: raw.username.trim(),
    displayName: parseOptionalString(raw.displayName),
    email: parseOptionalString(raw.email),
    role: raw.role as DeckRole,
    status: raw.status as DeckUserStatus,
    passwordSalt: raw.passwordSalt as string,
    passwordHash: raw.passwordHash,
    passwordVersion,
    assignedProfileIds: [...new Set(raw.assignedProfileIds as string[])],
    preferences: { profiles: validateProfiles(preferencesRaw.profiles) },
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    approvedAt: parseOptionalString(raw.approvedAt),
    approvedBy: parseOptionalString(raw.approvedBy),
    disabledAt: parseOptionalString(raw.disabledAt),
    disabledBy: parseOptionalString(raw.disabledBy),
    rejectedAt: parseOptionalString(raw.rejectedAt),
    rejectedBy: parseOptionalString(raw.rejectedBy),
    bootstrap: raw.bootstrap === true ? true : undefined,
  };
}

export function assertAuthStoreInvariants(store: DeckAuthStore): void {
  const users = Object.values(store.users);
  const superAdmins = users.filter((user) => user.role === 'super_admin');
  if (superAdmins.length !== 1) {
    throw new AuthStoreError('Invalid v2 auth store: expected exactly one active super_admin.');
  }
  if (superAdmins[0]!.status !== 'active') {
    throw new AuthStoreError('Invalid v2 auth store: super_admin must always be active.');
  }
  const seen = new Set<string>();
  for (const user of users) {
    const normalized = normalizeUsername(user.username);
    if (seen.has(normalized)) throw new AuthStoreError('Invalid v2 auth store: usernames must be unique.');
    seen.add(normalized);
  }
}

function validateAuthStoreV2(raw: unknown): DeckAuthStore {
  if (!isPlainObject(raw) || raw.version !== 2) throw new AuthStoreError('Invalid v2 auth store.');
  if (!isSafeSecret(raw.sessionSecret)) throw new AuthStoreError('Invalid v2 auth store: invalid session secret.');
  if (!isPlainObject(raw.users)) throw new AuthStoreError('Invalid v2 auth store: users must be an object.');
  if (raw.registrationsOpen !== true) throw new AuthStoreError('Invalid v2 auth store: registrationsOpen must be true.');
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') {
    throw new AuthStoreError('Invalid v2 auth store: missing timestamps.');
  }
  const users: Record<string, DeckUser> = {};
  for (const [id, user] of Object.entries(raw.users)) users[id] = validateUser(user, id);
  const store: DeckAuthStore = {
    version: 2,
    sessionSecret: raw.sessionSecret as string,
    users,
    registrationsOpen: true,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  assertAuthStoreInvariants(store);
  return store;
}

function validateAuthRecordV1(raw: unknown): AuthRecordV1 {
  if (!isPlainObject(raw) || raw.version !== 1) throw new AuthStoreError('Malformed v1 auth store.');
  if (!validUsername(raw.username)) throw new AuthStoreError('Malformed v1 auth store: invalid username.');
  if (!validPasswordMaterial(raw.passwordSalt, raw.passwordHash)) throw new AuthStoreError('Malformed v1 auth store: invalid password material.');
  if (!isSafeSecret(raw.sessionSecret)) throw new AuthStoreError('Malformed v1 auth store: invalid session secret.');
  if (raw.passwordVersion !== undefined && (!Number.isInteger(raw.passwordVersion) || (raw.passwordVersion as number) < 1)) {
    throw new AuthStoreError('Malformed v1 auth store: invalid password version.');
  }
  return {
    version: 1,
    username: raw.username.trim(),
    passwordSalt: raw.passwordSalt as string,
    passwordHash: raw.passwordHash as string,
    sessionSecret: raw.sessionSecret as string,
    passwordVersion: typeof raw.passwordVersion === 'number' ? raw.passwordVersion : 1,
    bootstrap: raw.bootstrap === true ? true : undefined,
  };
}

function writeAuth(record: DeckAuthStore) {
  assertAuthStoreInvariants(record);
  ensureDir();
  const tmp = join(AUTH_DIR, `.auth.json.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  let fd: number | null = null;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(record, null, 2), { encoding: 'utf8' });
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, AUTH_FILE);
    try { chmodSync(AUTH_FILE, 0o600); } catch {}
    fsyncDirIfPractical();
  } catch (error) {
    if (fd !== null) {
      try { closeSync(fd); } catch {}
    }
    try { unlinkSync(tmp); } catch {}
    throw error;
  }
}

function backupV1IfFeasible() {
  try {
    if (!existsSync(V1_BACKUP_FILE)) {
      copyFileSync(AUTH_FILE, V1_BACKUP_FILE);
      try { chmodSync(V1_BACKUP_FILE, 0o600); } catch {}
      fsyncDirIfPractical();
    }
  } catch {}
}

function defaultStore(): { record: DeckAuthStore; plaintext: string } {
  const plaintext = randomBytes(18).toString('base64url');
  const now = new Date().toISOString();
  const credentials = createPasswordRecord(plaintext);
  const superAdmin: DeckUser = {
    id: 'super_admin',
    username: 'admin',
    role: 'super_admin',
    status: 'active',
    ...credentials,
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: 'system',
    bootstrap: true,
  };
  return {
    record: {
      version: 2,
      sessionSecret: randomBytes(32).toString('hex'),
      users: { [superAdmin.id]: superAdmin },
      registrationsOpen: true,
      createdAt: now,
      updatedAt: now,
    },
    plaintext,
  };
}

function migrateV1ToV2(raw: unknown): DeckAuthStore {
  const v1 = validateAuthRecordV1(raw);
  const now = new Date().toISOString();
  const userId = `super_admin_${randomUUID()}`;
  const superAdmin: DeckUser = {
    id: userId,
    username: v1.username,
    role: 'super_admin',
    status: 'active',
    passwordSalt: v1.passwordSalt,
    passwordHash: v1.passwordHash,
    passwordVersion: v1.passwordVersion,
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: 'migration:v1',
    bootstrap: v1.bootstrap,
  };
  const next: DeckAuthStore = {
    version: 2,
    sessionSecret: v1.sessionSecret,
    users: { [userId]: superAdmin },
    registrationsOpen: true,
    createdAt: now,
    updatedAt: now,
  };
  assertAuthStoreInvariants(next);
  backupV1IfFeasible();
  writeAuth(next);
  return next;
}

let cached: DeckAuthStore | null = null;
let cachedMtimeMs = 0;
let printedBootstrapBanner = false;
// Serializes first-boot init so two concurrent callers don't each generate
// a different bootstrap password and race writeAuth().
let firstBootPromise: Promise<DeckAuthStore> | null = null;

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
  console.log(banner);
}

function parseAuthFile(): unknown {
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as unknown;
  } catch (error) {
    throw new AuthStoreError(`Invalid auth store: unable to read or parse ${AUTH_FILE}.`);
  }
}

function readExistingAuth(): DeckAuthStore | null {
  const mtime = currentMtimeMs();
  if (cached && mtime && mtime === cachedMtimeMs) return cached;
  if (!existsSync(AUTH_FILE)) return null;
  const raw = parseAuthFile();
  if (isPlainObject(raw) && raw.version === 1) {
    cached = migrateV1ToV2(raw);
    cachedMtimeMs = currentMtimeMs();
    return cached;
  }
  if (isPlainObject(raw) && raw.version === 2) {
    cached = validateAuthStoreV2(raw);
    cachedMtimeMs = mtime;
    return cached;
  }
  throw new AuthStoreError('Invalid auth store: unsupported or malformed version.');
}

function createInitialAuth(): DeckAuthStore {
  const existing = readExistingAuth();
  if (existing) return existing;
  const seeded = defaultStore();
  cached = seeded.record;
  writeAuth(cached);
  cachedMtimeMs = currentMtimeMs();
  maybeAnnounceBootstrap(seeded.plaintext);
  return cached;
}

export async function ensureAuthInitialized(): Promise<DeckAuthStore> {
  const existing = readExistingAuth();
  if (existing) return existing;
  if (!firstBootPromise) {
    firstBootPromise = Promise.resolve().then(createInitialAuth).finally(() => { firstBootPromise = null; });
  }
  return firstBootPromise;
}

export function readAuth(): DeckAuthStore {
  return readExistingAuth() || createInitialAuth();
}

function saveAuth(next: DeckAuthStore) {
  const withUpdatedAt = { ...next, updatedAt: new Date().toISOString() };
  assertAuthStoreInvariants(withUpdatedAt);
  cached = withUpdatedAt;
  writeAuth(withUpdatedAt);
  cachedMtimeMs = currentMtimeMs();
}

function findUserByUsername(store: DeckAuthStore, username: string): DeckUser | undefined {
  const normalized = normalizeUsername(username);
  return Object.values(store.users).find((user) => normalizeUsername(user.username) === normalized);
}

function getSuperAdmin(store = readAuth()): DeckUser {
  const superAdmin = Object.values(store.users).find((user) => user.role === 'super_admin');
  if (!superAdmin || superAdmin.status !== 'active') throw new AuthStoreError('Invalid v2 auth store: expected active super_admin.');
  return superAdmin;
}

function getUser(store: DeckAuthStore, userId: string): DeckUser | undefined {
  return store.users[userId];
}

function capabilitiesFor(user: Pick<DeckUser, 'role' | 'status'>): SafeDeckUserContext['capabilities'] {
  const active = user.status === 'active';
  const admin = user.role === 'admin' || user.role === 'super_admin';
  return {
    canUseApp: active,
    canManageUsers: active && admin,
    canApproveUsers: active && admin,
    canUseTerminal: active && admin,
    canManageOwnCredentials: active,
  };
}

export function toSafeUserContext(user: DeckUser): SafeDeckUserContext {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    assignedProfileIds: [...user.assignedProfileIds],
    capabilities: capabilitiesFor(user),
  };
}

export function toSafeAdminDeckUser(user: DeckUser): SafeAdminDeckUser {
  return {
    ...toSafeUserContext(user),
    immutable: user.role === 'super_admin',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    approvedAt: user.approvedAt,
    approvedBy: user.approvedBy,
    disabledAt: user.disabledAt,
    disabledBy: user.disabledBy,
    rejectedAt: user.rejectedAt,
    rejectedBy: user.rejectedBy,
  };
}

export function listSafeDeckUsers(): SafeAdminDeckUser[] {
  return Object.values(readAuth().users)
    .sort((a, b) => {
      const statusRank = (status: DeckUserStatus) => status === 'pending' ? 0 : status === 'active' ? 1 : status === 'disabled' ? 2 : 3;
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      if (a.role === 'super_admin') return -1;
      if (b.role === 'super_admin') return 1;
      return a.createdAt.localeCompare(b.createdAt) || a.username.localeCompare(b.username);
    })
    .map(toSafeAdminDeckUser);
}

function actorCanManageTarget(actor: DeckUser, target: DeckUser, action: 'update' | 'assign'): { ok: true } | { ok: false; error: string } {
  if (actor.status !== 'active' || (actor.role !== 'admin' && actor.role !== 'super_admin')) {
    return { ok: false, error: 'Only active admins can manage users.' };
  }
  if (target.role === 'super_admin') {
    return { ok: false, error: 'The immutable super_admin account cannot be modified.' };
  }
  if (actor.role === 'admin' && target.role !== 'user') {
    return { ok: false, error: action === 'assign' ? 'Admins can assign profiles only for ordinary users.' : 'Admins can manage ordinary users only.' };
  }
  return { ok: true };
}

function parseOptionalAdminString(value: unknown, maxLength: number, fieldName: string): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false, error: `${fieldName} must be a string.` };
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return { ok: false, error: `${fieldName} is too long.` };
  return { ok: true, value: trimmed || undefined };
}

export function updateDeckUserByAdmin(actorUserId: string, targetUserId: string, patch: AdminUserPatch): AdminUserMutationResult {
  const rec = readAuth();
  const actor = getUser(rec, actorUserId);
  const target = getUser(rec, targetUserId);
  if (!actor || actor.status !== 'active' || (actor.role !== 'admin' && actor.role !== 'super_admin')) {
    return { ok: false, code: 'forbidden', error: 'Only active admins can manage users.' };
  }
  if (!target) return { ok: false, code: 'not_found', error: 'User not found.' };
  const access = actorCanManageTarget(actor, target, 'update');
  if (!access.ok) return { ok: false, code: 'forbidden', error: access.error };

  const next: DeckUser = { ...target };
  let changed = false;

  if (patch.displayName !== undefined || patch.displayName === null) {
    const parsed = parseOptionalAdminString(patch.displayName, 120, 'Display name');
    if (!parsed.ok) return { ok: false, code: 'invalid', error: parsed.error };
    next.displayName = parsed.value;
    changed = true;
  }
  if (patch.email !== undefined || patch.email === null) {
    const parsed = parseOptionalAdminString(patch.email, 254, 'Email');
    if (!parsed.ok) return { ok: false, code: 'invalid', error: parsed.error };
    if (parsed.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.value.toLowerCase())) {
      return { ok: false, code: 'invalid', error: 'Email must be a valid email address.' };
    }
    next.email = parsed.value?.toLowerCase();
    changed = true;
  }
  if (patch.role !== undefined) {
    if (!validateRole(patch.role)) return { ok: false, code: 'invalid', error: 'Invalid role.' };
    if (patch.role === 'super_admin') return { ok: false, code: 'forbidden', error: 'Cannot create a second super_admin.' };
    if (actor.role !== 'super_admin') return { ok: false, code: 'forbidden', error: 'Only super_admin can change user roles.' };
    next.role = patch.role;
    changed = true;
  }
  if (patch.status !== undefined) {
    if (!validateStatus(patch.status)) return { ok: false, code: 'invalid', error: 'Invalid status.' };
    const now = new Date().toISOString();
    next.status = patch.status;
    if (patch.status === 'active') {
      next.approvedAt = next.approvedAt || now;
      next.approvedBy = actor.id;
      next.disabledAt = undefined;
      next.disabledBy = undefined;
      next.rejectedAt = undefined;
      next.rejectedBy = undefined;
    } else if (patch.status === 'disabled') {
      next.disabledAt = now;
      next.disabledBy = actor.id;
    } else if (patch.status === 'rejected') {
      next.rejectedAt = now;
      next.rejectedBy = actor.id;
    }
    changed = true;
  }

  if (!changed) return { ok: true, user: toSafeAdminDeckUser(target) };
  next.updatedAt = new Date().toISOString();
  const nextStore: DeckAuthStore = { ...rec, users: { ...rec.users, [target.id]: next } };
  try {
    assertAuthStoreInvariants(nextStore);
    saveAuth(nextStore);
  } catch (error) {
    return { ok: false, code: 'invalid', error: error instanceof Error ? error.message : 'Invalid user update.' };
  }
  return { ok: true, user: toSafeAdminDeckUser(next) };
}

export function replaceDeckUserProfileAssignments(
  actorUserId: string,
  targetUserId: string,
  assignedProfileIds: unknown,
  validProfileIds: readonly string[],
): AdminUserMutationResult {
  const rec = readAuth();
  const actor = getUser(rec, actorUserId);
  const target = getUser(rec, targetUserId);
  if (!actor || actor.status !== 'active' || (actor.role !== 'admin' && actor.role !== 'super_admin')) {
    return { ok: false, code: 'forbidden', error: 'Only active admins can manage profile assignments.' };
  }
  if (!target) return { ok: false, code: 'not_found', error: 'User not found.' };
  const access = actorCanManageTarget(actor, target, 'assign');
  if (!access.ok) return { ok: false, code: 'forbidden', error: access.error };
  if (!Array.isArray(assignedProfileIds) || assignedProfileIds.some((id) => typeof id !== 'string')) {
    return { ok: false, code: 'invalid', error: 'assignedProfileIds must be an array of profile ids.' };
  }
  const valid = new Set(validProfileIds);
  const normalized = [...new Set(assignedProfileIds.map((id) => id.trim()).filter(Boolean))];
  const invalid = normalized.filter((id) => !valid.has(id));
  if (invalid.length) {
    return { ok: false, code: 'invalid_profile', error: `Invalid profile id(s): ${invalid.join(', ')}` };
  }
  const next: DeckUser = {
    ...target,
    assignedProfileIds: normalized,
    updatedAt: new Date().toISOString(),
  };
  saveAuth({ ...rec, users: { ...rec.users, [target.id]: next } });
  return { ok: true, user: toSafeAdminDeckUser(next) };
}

const MODEL_PREF_PROFILE_ID_RE = /^[\w.-]{1,64}$/;

function parseModelPreferencePatch(input: { modelId?: unknown; modelProvider?: unknown }):
  | { ok: true; modelId?: string; modelProvider?: string }
  | { ok: false; error: string } {
  const parse = (value: unknown, field: 'modelId' | 'modelProvider', maxLength: number) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return { error: `${field} must be a string.` };
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > maxLength) return { error: `${field} is too long.` };
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { error: `${field} contains invalid control characters.` };
    return trimmed;
  };
  const modelId = parse(input.modelId, 'modelId', 256);
  if (modelId && typeof modelId === 'object') return { ok: false, error: modelId.error };
  const modelProvider = parse(input.modelProvider, 'modelProvider', 128);
  if (modelProvider && typeof modelProvider === 'object') return { ok: false, error: modelProvider.error };
  return {
    ok: true,
    ...(typeof modelId === 'string' ? { modelId } : {}),
    ...(typeof modelProvider === 'string' ? { modelProvider } : {}),
  };
}

export type DeckModelPreferenceResult =
  | { ok: true; preference: DeckModelPreference }
  | { ok: false; code: 'not_found' | 'invalid'; error: string };

export function getDeckModelPreference(userId: string, profileId: string): DeckModelPreference | null {
  if (!MODEL_PREF_PROFILE_ID_RE.test(profileId)) return null;
  const user = getUser(readAuth(), userId);
  if (!user) return null;
  const pref = user.preferences.profiles[profileId];
  return pref ? { ...pref } : null;
}

export function updateDeckModelPreference(
  userId: string,
  profileId: string,
  input: { modelId?: unknown; modelProvider?: unknown },
): DeckModelPreferenceResult {
  if (!MODEL_PREF_PROFILE_ID_RE.test(profileId)) {
    return { ok: false, code: 'invalid', error: 'Profile id is invalid.' };
  }
  const parsed = parseModelPreferencePatch(input);
  if (!parsed.ok) return { ok: false, code: 'invalid', error: parsed.error };
  const rec = readAuth();
  const target = getUser(rec, userId);
  if (!target) return { ok: false, code: 'not_found', error: 'User not found.' };
  const preference: DeckModelPreference = {
    ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
    ...(parsed.modelProvider ? { modelProvider: parsed.modelProvider } : {}),
    updatedAt: new Date().toISOString(),
  };
  const next: DeckUser = {
    ...target,
    preferences: {
      ...target.preferences,
      profiles: {
        ...target.preferences.profiles,
        [profileId]: preference,
      },
    },
    updatedAt: preference.updatedAt,
  };
  saveAuth({ ...rec, users: { ...rec.users, [target.id]: next } });
  return { ok: true, preference };
}

export function registerPendingUser(input: RegisterPendingUserInput): RegisterPendingUserResult {
  const fields = validateRegistrationFields(input);
  if (!fields.ok) return { ok: false, error: fields.error, code: 'invalid' };

  const rec = readAuth();
  if (findUserByUsername(rec, fields.username)) {
    return { ok: false, error: 'Username is already in use.', code: 'duplicate' };
  }

  const now = new Date().toISOString();
  const id = `user_${randomUUID()}`;
  const user: DeckUser = {
    id,
    username: fields.username,
    displayName: fields.displayName,
    email: fields.email,
    role: 'user',
    status: 'pending',
    ...createPasswordRecord(fields.password),
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
  };

  saveAuth({
    ...rec,
    users: {
      ...rec.users,
      [id]: user,
    },
  });

  return { ok: true, user: toSafeUserContext(user) };
}

function verifyPasswordForUser(password: string, user: Pick<DeckUser, 'passwordHash' | 'passwordSalt'>): boolean {
  const expected = Buffer.from(user.passwordHash, 'hex');
  // Always run scrypt — even on empty input — so the timing of a wrong-username
  // login matches the timing of a wrong-password login. Without this an
  // attacker could enumerate valid usernames.
  let actual: Buffer;
  try { actual = Buffer.from(hashPassword(password || '', user.passwordSalt), 'hex'); }
  catch { actual = Buffer.alloc(expected.length); }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function getUsername(): string {
  return getSuperAdmin().username;
}

export function isBootstrapPassword(userId?: string): boolean {
  const store = readAuth();
  const user = userId ? getUser(store, userId) : getSuperAdmin(store);
  return user?.bootstrap === true;
}

export function verifyPassword(password: string, usernameOrUserId?: string): boolean {
  const store = readAuth();
  const user = usernameOrUserId
    ? (getUser(store, usernameOrUserId) || findUserByUsername(store, usernameOrUserId))
    : getSuperAdmin(store);
  const timingUser = user || getSuperAdmin(store);
  const passwordOk = verifyPasswordForUser(password, timingUser);
  return Boolean(user && passwordOk);
}

export type AuthenticateResult =
  | { ok: true; user: DeckUser }
  | { ok: false };

export function authenticateUser(username: string, password: string, options?: { allowStatuses?: DeckUserStatus[] }): AuthenticateResult {
  const store = readAuth();
  const user = findUserByUsername(store, username);
  const timingUser = user || getSuperAdmin(store);
  const passwordOk = verifyPasswordForUser(password, timingUser);
  if (!user || !passwordOk) return { ok: false };
  const allowedStatuses = options?.allowStatuses || ['active'];
  if (!allowedStatuses.includes(user.status)) return { ok: false };
  return { ok: true, user };
}

export function updateUsername(nextUsername: string, userId?: string): { ok: true } | { ok: false; error: string } {
  const trimmed = nextUsername.trim();
  if (trimmed.length < 1 || trimmed.length > 64) return { ok: false, error: 'Username must be 1–64 characters.' };
  if (!/^[A-Za-z0-9_.\-@]+$/.test(trimmed)) return { ok: false, error: 'Username may only contain letters, digits, and _.-@' };
  const rec = readAuth();
  const target = userId ? getUser(rec, userId) : getSuperAdmin(rec);
  if (!target) return { ok: false, error: 'User not found.' };
  if (target.role === 'super_admin') return { ok: false, error: 'The super_admin username cannot be changed.' };
  const normalized = normalizeUsername(trimmed);
  const duplicate = Object.values(rec.users).find((user) => user.id !== target.id && normalizeUsername(user.username) === normalized);
  if (duplicate) return { ok: false, error: 'Username is already in use.' };
  saveAuth({
    ...rec,
    users: {
      ...rec.users,
      [target.id]: { ...target, username: trimmed, updatedAt: new Date().toISOString() },
    },
  });
  return { ok: true };
}

export function updatePassword(currentPassword: string, nextPassword: string, userId?: string): { ok: true } | { ok: false; error: string } {
  const rec = readAuth();
  const target = userId ? getUser(rec, userId) : getSuperAdmin(rec);
  if (!target) return { ok: false, error: 'User not found.' };
  if (!verifyPasswordForUser(currentPassword, target)) return { ok: false, error: 'Current password is incorrect.' };
  if (typeof nextPassword !== 'string' || nextPassword.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `New password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (nextPassword.length > 256) return { ok: false, error: 'New password is too long.' };
  const credentials = createPasswordRecord(nextPassword, target.passwordVersion + 1);
  saveAuth({
    ...rec,
    users: {
      ...rec.users,
      [target.id]: {
        ...target,
        ...credentials,
        updatedAt: new Date().toISOString(),
        bootstrap: undefined,
      },
    },
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

export type Payload = { u: string; pv: number; iat: number; exp: number };

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

export function issueSessionToken(userIdOrNow?: string | number, nowOrTtlMs?: number, maybeTtlMs?: number): string {
  const rec = readAuth();
  let userId: string | undefined;
  let now: number;
  let ttlMs: number;
  if (typeof userIdOrNow === 'string') {
    userId = userIdOrNow;
    now = typeof nowOrTtlMs === 'number' ? nowOrTtlMs : Date.now();
    ttlMs = typeof maybeTtlMs === 'number' ? maybeTtlMs : SESSION_TTL_MS;
  } else {
    userId = undefined;
    now = typeof userIdOrNow === 'number' ? userIdOrNow : Date.now();
    ttlMs = typeof nowOrTtlMs === 'number' ? nowOrTtlMs : SESSION_TTL_MS;
  }
  const user = userId ? getUser(rec, userId) : getSuperAdmin(rec);
  if (!user || user.status !== 'active') throw new AuthStoreError('Cannot issue a session for an inactive or missing user.');
  const payload: Payload = { u: user.id, pv: user.passwordVersion, iat: now, exp: now + ttlMs };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = sign(body, rec.sessionSecret);
  return `${body}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: Payload; user: DeckUser; shouldRefresh: boolean }
  | { ok: false };

export function verifySessionToken(
  token: string | undefined | null,
  now = Date.now(),
  options?: { allowStatuses?: DeckUserStatus[] },
): VerifyResult {
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
  if (typeof payload.u !== 'string') return { ok: false };
  const user = getUser(rec, payload.u);
  if (!user) return { ok: false };
  if (payload.pv !== user.passwordVersion) return { ok: false };
  if (typeof payload.exp !== 'number' || payload.exp <= now) return { ok: false };
  const allowedStatuses = options?.allowStatuses || ['active'];
  if (!allowedStatuses.includes(user.status)) return { ok: false };
  const shouldRefresh = (now - (payload.iat || 0)) > REFRESH_AFTER_MS;
  return { ok: true, payload, user, shouldRefresh };
}
