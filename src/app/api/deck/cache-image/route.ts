import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/server/rbac';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve as pathResolve, sep, extname } from 'node:path';
import { Readable } from 'node:stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HERMES_CACHE_ROOTS = [
  pathResolve(homedir(), '.hermes', 'cache'),
];

// Cap individual responses; the cache should only hold model-generated assets
// well under this. Anything larger means something unexpected.
const MAX_BYTES = 32 * 1024 * 1024;
// Stream files over this size instead of buffering the whole thing.
const STREAM_OVER_BYTES = 4 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
};

function isInsideAnyRoot(absPath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const r = root.endsWith(sep) ? root : root + sep;
    return absPath === root || absPath.startsWith(r);
  });
}

function isInsideAllowedRoot(absPath: string): boolean {
  return isInsideAnyRoot(absPath, HERMES_CACHE_ROOTS);
}

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const raw = url.searchParams.get('path');
  if (!raw) return new Response('missing "path" query parameter', { status: 400 });

  const abs = pathResolve(raw);
  if (!isInsideAllowedRoot(abs)) {
    return new Response('path is outside the allowed Hermes cache root', { status: 403 });
  }

  // lstat does NOT follow symlinks, so we can reject any symlink up front
  // before either stat or readFile gets a chance to follow one to an
  // attacker-chosen target. This closes the small TOCTOU window between an
  // earlier stat-then-readFile sequence.
  let info;
  try {
    info = await lstat(abs);
  } catch {
    return new Response('file not found', { status: 404 });
  }
  if (info.isSymbolicLink()) {
    return new Response('symlinks are not permitted', { status: 403 });
  }
  if (!info.isFile()) {
    return new Response('not a regular file', { status: 400 });
  }
  if (info.size > MAX_BYTES) {
    return new Response(`file exceeds ${MAX_BYTES} byte cap`, { status: 413 });
  }

  // Belt-and-braces: even though lstat said it's a regular file, resolve the
  // realpath of the directory chain and confirm it's still inside the root.
  // If realpath itself errors (permission denied, missing intermediate), we
  // fail closed — never fall back to the unresolved path. This was the
  // original `.catch(() => abs)` bypass.
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    return new Response('resolved path could not be verified', { status: 403 });
  }
  if (!isInsideAllowedRoot(real)) {
    let realRoots: string[];
    try {
      realRoots = await Promise.all(HERMES_CACHE_ROOTS.map((root) => realpath(root)));
    } catch {
      return new Response('resolved cache root could not be verified', { status: 403 });
    }
    if (!isInsideAnyRoot(real, realRoots)) {
      return new Response('resolved path is outside the allowed Hermes cache root', { status: 403 });
    }
  }

  const ext = extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return new Response('unsupported image type', { status: 415 });
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Length': String(info.size),
    'Cache-Control': 'private, max-age=86400, immutable',
  };
  // SVG can carry inline <script>, which would execute on the deck origin
  // (where the session cookie lives). Force download for SVG (and any other
  // potentially-active types) instead of rendering inline.
  if (ext === '.svg' || mime === 'image/svg+xml') {
    headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(abs.split(sep).pop() || 'image.svg')}"`;
  }
  // Stream large files instead of materializing the whole buffer in memory.
  if (info.size > STREAM_OVER_BYTES) {
    const nodeStream = createReadStream(abs);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(webStream, { status: 200, headers });
  }
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(abs);
  return new Response(data, { status: 200, headers });
}
