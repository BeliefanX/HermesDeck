const LOCAL_ABSOLUTE_PATH_RE = /^(?:\/(?:Users|home|var|private|tmp|Volumes)\/|[a-zA-Z]:[\\/])/;
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_ATTACHMENT_WEB_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_IMAGE_DATA_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i;
const HERMESDECK_BASE = 'https://hermesdeck.local';

export function safeMarkdownHref(rawHref: unknown): string | null {
  if (typeof rawHref !== 'string') return null;
  const href = rawHref.trim();
  if (!href) return null;
  if (href.startsWith('#')) return href;

  if (LOCAL_ABSOLUTE_PATH_RE.test(href)) return null;

  try {
    const parsed = new URL(href, HERMESDECK_BASE);
    if (parsed.protocol === 'https:' && parsed.origin === HERMESDECK_BASE) {
      if (parsed.pathname.startsWith('/api/')) return null;
      if (LOCAL_ABSOLUTE_PATH_RE.test(parsed.pathname)) return null;
      return href;
    }
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? href : null;
  } catch {
    return null;
  }
}

function safeSameOriginAttachmentPath(parsed: URL, raw: string, opts: { allowCacheImageApi?: boolean }): string | null {
  if (parsed.protocol !== 'https:' || parsed.origin !== HERMESDECK_BASE) return null;
  if (LOCAL_ABSOLUTE_PATH_RE.test(parsed.pathname)) return null;
  if (parsed.pathname.startsWith('/api/')) {
    if (opts.allowCacheImageApi && parsed.pathname === '/api/deck/cache-image') return raw;
    return null;
  }
  return raw;
}

/**
 * Sanitizes attachment URLs before they are used in image previews. This allows
 * only browser-safe image-bearing schemes and app paths; local filesystem paths
 * and active/non-image data URLs are intentionally rejected.
 */
export function safeAttachmentImageUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const url = rawUrl.trim();
  if (!url || LOCAL_ABSOLUTE_PATH_RE.test(url)) return null;
  if (SAFE_IMAGE_DATA_RE.test(url)) return url;
  if (/^blob:/i.test(url)) return url;

  try {
    const parsed = new URL(url, HERMESDECK_BASE);
    if (SAFE_ATTACHMENT_WEB_PROTOCOLS.has(parsed.protocol) && parsed.origin !== HERMESDECK_BASE) return url;
    return safeSameOriginAttachmentPath(parsed, url, { allowCacheImageApi: true });
  } catch {
    return null;
  }
}

/**
 * Sanitizes attachment URLs before exposing them as user-clickable downloads or
 * navigation targets. API routes are blocked here even when image rendering may
 * use a tightly scoped proxy endpoint.
 */
export function safeAttachmentDownloadUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const url = rawUrl.trim();
  if (!url || LOCAL_ABSOLUTE_PATH_RE.test(url)) return null;
  if (SAFE_IMAGE_DATA_RE.test(url)) return url;
  if (/^blob:/i.test(url)) return url;

  try {
    const parsed = new URL(url, HERMESDECK_BASE);
    if (SAFE_ATTACHMENT_WEB_PROTOCOLS.has(parsed.protocol) && parsed.origin !== HERMESDECK_BASE) return url;
    return safeSameOriginAttachmentPath(parsed, url, { allowCacheImageApi: false });
  } catch {
    return null;
  }
}
