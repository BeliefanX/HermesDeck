const LOCAL_ABSOLUTE_PATH_RE = /^(?:\/(?:Users|home|var|private|tmp|Volumes)\/|[a-zA-Z]:[\\/])/;
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeMarkdownHref(rawHref: unknown): string | null {
  if (typeof rawHref !== 'string') return null;
  const href = rawHref.trim();
  if (!href) return null;
  if (href.startsWith('#')) return href;

  if (LOCAL_ABSOLUTE_PATH_RE.test(href)) return null;

  try {
    const parsed = new URL(href, 'https://hermesdeck.local');
    if (parsed.protocol === 'https:' && parsed.origin === 'https://hermesdeck.local') {
      if (parsed.pathname.startsWith('/api/')) return null;
      if (LOCAL_ABSOLUTE_PATH_RE.test(parsed.pathname)) return null;
      return href;
    }
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? href : null;
  } catch {
    return null;
  }
}
