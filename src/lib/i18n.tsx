'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';

export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'hermesdeck-lang';
const DEFAULT_LANG: Lang = 'zh';

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

let current: Lang = DEFAULT_LANG;
let hydrated = false;

function readStored(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'zh' || v === 'en') return v;
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
  // to the stored preference after mount. English users will see one frame
  // of Chinese; that's the same trade-off the theme bootstrap already makes.
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

