import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import webpush from 'web-push';

const DATA_DIR = process.env.HERMESDECK_DATA_DIR || process.env.HERMESDECK_AUTH_DIR || join(homedir(), '.hermesdeck');
const STORE_PATH = join(DATA_DIR, 'notifications.v1.json');
const MAX_SUBSCRIPTIONS_PER_USER = 16;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;

export type NotificationPreferenceKey = 'chatCompleted' | 'chatFailed' | 'kanbanTaskCompleted' | 'cronJobCompleted';

export type DeckNotificationPreferences = {
  chatCompleted: boolean;
  chatFailed: boolean;
  kanbanTaskCompleted: boolean;
  cronJobCompleted: boolean;
  updatedAt?: string;
};

export type DeckNotificationConfig = {
  available: boolean;
  publicKey: string | null;
  subject: string | null;
  reason?: string;
};

type StoredPushSubscription = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
};

type PublicPushSubscription = {
  id: string;
  expirationTime?: number | null;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
};

type UserNotificationState = {
  preferences: DeckNotificationPreferences;
  subscriptions: StoredPushSubscription[];
};

type NotificationStore = {
  version: 1;
  users: Record<string, UserNotificationState>;
  updatedAt: string;
};

export type PushSubscriptionInput = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: unknown;
};

export type NotificationDispatchKind = 'chat_completed' | 'chat_failed';

export type NotificationDispatchInput = {
  userId: string;
  profileId?: string;
  sessionId?: string;
  kind: NotificationDispatchKind;
  error?: string;
};

const DEFAULT_PREFERENCES: DeckNotificationPreferences = {
  chatCompleted: true,
  chatFailed: true,
  kanbanTaskCompleted: true,
  cronJobCompleted: true,
};

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function readStore(): NotificationStore {
  ensureDir();
  if (!existsSync(STORE_PATH)) return { version: 1, users: {}, updatedAt: nowIso() };
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as Partial<NotificationStore>;
    if (raw && raw.version === 1 && raw.users && typeof raw.users === 'object') {
      return {
        version: 1,
        users: raw.users as Record<string, UserNotificationState>,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
      };
    }
  } catch {}
  return { version: 1, users: {}, updatedAt: nowIso() };
}

function writeStore(store: NotificationStore): void {
  ensureDir();
  const next = { ...store, updatedAt: nowIso() };
  const tmp = `${STORE_PATH}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, STORE_PATH);
}

function normalizedUserState(store: NotificationStore, userId: string): UserNotificationState {
  const existing = store.users[userId];
  return {
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...(existing?.preferences || {}),
    },
    subscriptions: Array.isArray(existing?.subscriptions) ? existing.subscriptions : [],
  };
}

function publicOrigin(): string {
  const env = process.env.HERMESDECK_PUBLIC_ORIGIN?.split(',')[0]?.trim();
  return env || '';
}

function publicSubscriptionId(endpoint: string): string {
  return `sub_${createHash('sha256').update(endpoint).digest('base64url').slice(0, 32)}`;
}

function publicSubscription(sub: StoredPushSubscription): PublicPushSubscription {
  return {
    id: publicSubscriptionId(sub.endpoint),
    expirationTime: sub.expirationTime,
    userAgent: sub.userAgent,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  };
}

export function isSupportedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const ipHost = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!hostname || isIP(ipHost)) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
  return hostname === 'fcm.googleapis.com'
    || hostname === 'fcmregistrations.googleapis.com'
    || hostname === 'updates.push.services.mozilla.com'
    || hostname === 'push.services.mozilla.com'
    || hostname === 'web.push.apple.com'
    || hostname.endsWith('.notify.windows.com');
}

export function getNotificationConfig(): DeckNotificationConfig {
  const publicKey = process.env.HERMESDECK_VAPID_PUBLIC_KEY?.trim() || '';
  const privateKey = process.env.HERMESDECK_VAPID_PRIVATE_KEY?.trim() || '';
  const subject = process.env.HERMESDECK_VAPID_SUBJECT?.trim() || publicOrigin() || '';
  if (!publicKey || !privateKey || !subject) {
    return {
      available: false,
      publicKey: publicKey || null,
      subject: subject || null,
      reason: 'vapid_not_configured',
    };
  }
  return { available: true, publicKey, subject };
}

function configureWebPush(): DeckNotificationConfig {
  const config = getNotificationConfig();
  if (!config.available || !config.publicKey || !config.subject) return config;
  const privateKey = process.env.HERMESDECK_VAPID_PRIVATE_KEY?.trim() || '';
  if (!privateKey) return { ...config, available: false, reason: 'vapid_not_configured' };
  webpush.setVapidDetails(config.subject, config.publicKey, privateKey);
  return config;
}

function parseSubscription(input: PushSubscriptionInput): { ok: true; subscription: Omit<StoredPushSubscription, 'id' | 'createdAt' | 'updatedAt'> } | { ok: false; error: string } {
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  if (!endpoint || !isSupportedPushEndpoint(endpoint)) {
    return { ok: false, error: 'invalid_subscription' };
  }
  const keys = input.keys && typeof input.keys === 'object' ? input.keys as Record<string, unknown> : null;
  const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys?.auth === 'string' ? keys.auth.trim() : '';
  if (!p256dh || !auth || p256dh.length > MAX_KEY_LENGTH || auth.length > MAX_KEY_LENGTH) {
    return { ok: false, error: 'invalid_subscription' };
  }
  const expirationTime = typeof input.expirationTime === 'number' && Number.isFinite(input.expirationTime)
    ? input.expirationTime
    : null;
  return { ok: true, subscription: { endpoint, keys: { p256dh, auth }, expirationTime } };
}

export function getUserNotificationState(userId: string): UserNotificationState {
  return normalizedUserState(readStore(), userId);
}

export function getNotificationConfigForUser(userId: string): {
  config: DeckNotificationConfig;
  preferences: DeckNotificationPreferences;
  subscriptionCount: number;
  subscriptions: PublicPushSubscription[];
} {
  const state = getUserNotificationState(userId);
  return {
    config: getNotificationConfig(),
    preferences: state.preferences,
    subscriptionCount: state.subscriptions.length,
    subscriptions: state.subscriptions.map(publicSubscription),
  };
}

export function saveUserNotificationPreferences(userId: string, patch: Partial<Record<NotificationPreferenceKey, unknown>>): DeckNotificationPreferences {
  const store = readStore();
  const state = normalizedUserState(store, userId);
  const preferences: DeckNotificationPreferences = {
    ...state.preferences,
    ...(typeof patch.chatCompleted === 'boolean' ? { chatCompleted: patch.chatCompleted } : {}),
    ...(typeof patch.chatFailed === 'boolean' ? { chatFailed: patch.chatFailed } : {}),
    ...(typeof patch.kanbanTaskCompleted === 'boolean' ? { kanbanTaskCompleted: patch.kanbanTaskCompleted } : {}),
    ...(typeof patch.cronJobCompleted === 'boolean' ? { cronJobCompleted: patch.cronJobCompleted } : {}),
    updatedAt: nowIso(),
  };
  store.users[userId] = { ...state, preferences };
  writeStore(store);
  return preferences;
}

export function savePushSubscription(userId: string, input: PushSubscriptionInput, userAgent?: string | null): { ok: true; subscriptionCount: number; subscription: PublicPushSubscription } | { ok: false; error: string } {
  const parsed = parseSubscription(input);
  if (!parsed.ok) return parsed;
  const store = readStore();
  const state = normalizedUserState(store, userId);
  const now = nowIso();
  const existingIndex = state.subscriptions.findIndex((sub) => sub.endpoint === parsed.subscription.endpoint);
  const safeUserAgent = typeof userAgent === 'string' ? userAgent.slice(0, 240) : undefined;
  let saved: StoredPushSubscription;
  if (existingIndex >= 0) {
    const existing = state.subscriptions[existingIndex]!;
    saved = { ...existing, ...parsed.subscription, id: existing.id || publicSubscriptionId(parsed.subscription.endpoint), ...(safeUserAgent ? { userAgent: safeUserAgent } : {}), updatedAt: now };
    state.subscriptions[existingIndex] = saved;
  } else {
    saved = {
      id: publicSubscriptionId(parsed.subscription.endpoint),
      ...parsed.subscription,
      ...(safeUserAgent ? { userAgent: safeUserAgent } : {}),
      createdAt: now,
      updatedAt: now,
    };
    state.subscriptions.unshift(saved);
  }
  state.subscriptions = state.subscriptions.slice(0, MAX_SUBSCRIPTIONS_PER_USER);
  store.users[userId] = state;
  writeStore(store);
  return { ok: true, subscriptionCount: state.subscriptions.length, subscription: publicSubscription(saved) };
}

export function upsertPushSubscription(userId: string, input: PushSubscriptionInput, userAgent?: string | null): { ok: true; subscriptionCount: number; subscription: PublicPushSubscription } | { ok: false; error: string } {
  return savePushSubscription(userId, input, userAgent);
}

export function removePushSubscription(userId: string, endpoint: unknown): { ok: true; subscriptionCount: number } | { ok: false; error: string } {
  const endpointText = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (!endpointText) return { ok: false, error: 'invalid_endpoint' };
  const store = readStore();
  const state = normalizedUserState(store, userId);
  state.subscriptions = state.subscriptions.filter((sub) => sub.endpoint !== endpointText);
  store.users[userId] = state;
  writeStore(store);
  return { ok: true, subscriptionCount: state.subscriptions.length };
}

function removeExpiredSubscriptions(userId: string, endpoints: Set<string>): void {
  if (!endpoints.size) return;
  const store = readStore();
  const state = normalizedUserState(store, userId);
  const next = state.subscriptions.filter((sub) => !endpoints.has(sub.endpoint));
  if (next.length === state.subscriptions.length) return;
  store.users[userId] = { ...state, subscriptions: next };
  writeStore(store);
}

function notificationUrl(input: NotificationDispatchInput): string {
  if (!input.profileId) return '/chat';
  const params = new URLSearchParams({ profile: input.profileId });
  if (input.sessionId) params.set('session', input.sessionId);
  return `/chat?${params.toString()}`;
}

function notificationPayload(input: NotificationDispatchInput): string {
  const profileLabel = input.profileId || 'HermesDeck';
  const tagProfile = input.profileId || 'test';
  const tagSession = input.sessionId || 'test';
  if (input.kind === 'chat_failed') {
    return JSON.stringify({
      title: 'HermesDeck chat failed',
      body: `Agent ${profileLabel} hit an error. Open the chat for details.`,
      url: notificationUrl(input),
      tag: `chat:${tagProfile}:${tagSession}:failed`,
    });
  }
  return JSON.stringify({
    title: 'HermesDeck chat complete',
    body: `Agent ${profileLabel} finished a reply.`,
    url: notificationUrl(input),
    tag: `chat:${tagProfile}:${tagSession}:complete`,
  });
}

export async function dispatchChatNotification(input: NotificationDispatchInput): Promise<{ ok: true; sent: number; unavailable?: boolean } | { ok: false; error: string }> {
  const config = configureWebPush();
  if (!config.available) return { ok: true, sent: 0, unavailable: true };
  const state = getUserNotificationState(input.userId);
  if (input.kind === 'chat_completed' && !state.preferences.chatCompleted) return { ok: true, sent: 0 };
  if (input.kind === 'chat_failed' && !state.preferences.chatFailed) return { ok: true, sent: 0 };
  if (!state.subscriptions.length) return { ok: true, sent: 0 };

  const payload = notificationPayload(input);
  let sent = 0;
  const expired = new Set<string>();
  await Promise.all(state.subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription, payload, { TTL: 60 * 60 });
      sent += 1;
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) expired.add(sub.endpoint);
      // Deliberately do not log endpoint/key details; chat streaming must not fail on push errors.
    }
  }));
  removeExpiredSubscriptions(input.userId, expired);
  return { ok: true, sent };
}
