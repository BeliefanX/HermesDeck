'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';

export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'hermesdeck-lang';
const DEFAULT_LANG: Lang = 'en';

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

let current: Lang = DEFAULT_LANG;
let hydrated = false;

function readStored(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'zh' || v === 'zh-CN') return 'zh';
    if (v === 'en') return 'en';
  } catch {}
  // Fall back to navigator language for first-visit users.
  try {
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('en')) return 'en';
  } catch {}
  return DEFAULT_LANG;
}

function ensureHydrated() {
  if (hydrated || typeof window === 'undefined') return;
  current = readStored();
  try { document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en'; } catch {}
  hydrated = true;
}

export function getLang(): Lang {
  ensureHydrated();
  return current;
}

export function setLang(next: Lang) {
  if (next !== 'zh' && next !== 'en') return;
  current = next;
  hydrated = true;
  try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  try { document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'; } catch {}
  subscribers.forEach((fn) => fn());
}

export function toggleLang() {
  setLang(getLang() === 'zh' ? 'en' : 'zh');
}

function subscribe(cb: Subscriber): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function useLang(): Lang {
  const stored = useSyncExternalStore(
    subscribe,
    () => { ensureHydrated(); return current; },
    () => DEFAULT_LANG,
  );
  // The server snapshot returns DEFAULT_LANG (the only thing we know without
  // the browser). The client snapshot reads localStorage and may differ —
  // which would cause a hydration mismatch on every translated string. Pin
  // the first client render to DEFAULT_LANG to match the server, then flip
  // to the stored/browser preference after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? stored : DEFAULT_LANG;
}

/**
 * Translation hook. Pass an object keyed by language and the hook returns the
 * dictionary for the current language. Each component owns its own strings —
 * we trade a tiny amount of duplication for total decoupling: there is no
 * central key registry that grows unbounded as features land.
 *
 * Usage:
 *   const t = useT({
 *     zh: { title: '主页', open: '打开' },
 *     en: { title: 'Home', open: 'Open' },
 *   });
 *   <h1>{t.title}</h1>
 */
export function useT<T extends Record<string, unknown>>(dict: { zh: T; en: T }): T {
  const lang = useLang();
  return dict[lang] || dict.zh;
}

const ERROR_MAP: Record<string, { zh: string; en: string }> = {
  'Cross-origin request rejected': { zh: '跨来源请求已被拒绝。', en: 'Cross-origin request rejected.' },
  'Not authenticated': { zh: '未登录或会话已过期，请重新登录。', en: 'Not authenticated or session expired. Please sign in again.' },
  'Authentication required': { zh: '需要登录后才能继续。', en: 'Authentication required.' },
  'Forbidden': { zh: '没有权限执行此操作。', en: 'You do not have permission to perform this action.' },
  'Pending approval': { zh: '账户仍在等待管理员批准。', en: 'Account is still pending administrator approval.' },
  'Account disabled': { zh: '账户已被停用。', en: 'Account is disabled.' },
  'Account rejected': { zh: '账户申请已被拒绝。', en: 'Account request was rejected.' },
  'Invalid username or password': { zh: '用户名或密码错误。', en: 'Invalid username or password.' },
  'Network error.': { zh: '网络错误，请稍后重试。', en: 'Network error — please try again.' },
  'Failed to save changes.': { zh: '保存失败。', en: 'Failed to save changes.' },
};

export function localizeError(message: unknown, lang: Lang): string {
  const raw = typeof message === 'string' ? message : String(message || '');
  const trimmed = raw.trim();
  if (!trimmed) return lang === 'zh' ? '发生未知错误。' : 'Unknown error.';
  const exact = ERROR_MAP[trimmed];
  if (exact) return exact[lang];
  const lowered = trimmed.toLowerCase();
  for (const [key, val] of Object.entries(ERROR_MAP)) {
    if (lowered.includes(key.toLowerCase())) return val[lang];
  }
  return trimmed;
}

