import type { DeckAttachment } from './types';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;       // 20MB total file cap (pre-compression)
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;      // 20MB original image cap; we compress before sending
export const MAX_TEXT_CHARS = 200_000;               // mirrors the server route
export const SMART_PASTE_THRESHOLD = 1500;           // chars; above this, paste becomes attachment

// The Hermes API Server caps the entire request body at 1 MB
// (`MAX_REQUEST_BYTES` in api_server.py). The body is JSON, so the data URL
// must be considerably smaller — we leave headroom for prompt text, history,
// and JSON overhead. Open-WebUI uses ~768KB after resize for the same reason.
const TARGET_IMAGE_BYTES = 700 * 1024;
// Anthropic's recommended max long edge for vision is ~1568px; smaller
// dimensions mean fewer tokens AND smaller payloads.
const MAX_IMAGE_DIMENSION = 1568;
const MIN_IMAGE_DIMENSION = 384; // never shrink below this on the long edge

const TEXT_LIKE_EXT = new Set([
  'txt', 'md', 'markdown', 'mdx', 'rst', 'org',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env', 'properties',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift',
  'cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'hxx', 'cs', 'm', 'mm',
  'php', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'css', 'scss', 'sass', 'less', 'styl',
  'html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'astro',
  'sql', 'graphql', 'gql', 'proto',
  'log', 'csv', 'tsv', 'gitignore', 'gitattributes', 'dockerfile',
  'lua', 'r', 'pl', 'lisp', 'el', 'scala', 'clj', 'ex', 'exs', 'erl',
  'tex', 'bib',
]);

type Classification = 'image' | 'text' | 'pdf' | 'docx' | 'unsupported';

function ext(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function classify(file: File): Classification {
  const e = ext(file.name);
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf' || e === 'pdf') return 'pdf';
  if (e === 'docx' || file.type.includes('officedocument.wordprocessingml')) return 'docx';
  if (file.type.startsWith('text/')) return 'text';
  if (TEXT_LIKE_EXT.has(e)) return 'text';
  // Files without extension are often text scripts; if the file is small,
  // try as text. Above 1MB without a known type, refuse.
  if (!e && file.size < 1024 * 1024) return 'text';
  return 'unsupported';
}

function clipText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS) + `\n\n[…truncated at ${MAX_TEXT_CHARS} chars]`;
}

async function readAsText(file: File): Promise<string> {
  return clipText(await file.text());
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

function loadImageBitmap(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  // Prefer createImageBitmap when available — decodes off the main thread and
  // avoids spinning up an HTMLImageElement.
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then((bmp) => ({
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close?.(),
    }));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => URL.revokeObjectURL(url),
    });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

function approxDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  const b64 = dataUrl.length - comma - 1;
  return Math.floor(b64 * 3 / 4);
}

/**
 * Compress an image so it fits the Hermes API Server's 1 MB body budget.
 * Strategy: scale long edge down (max 1568px), JPEG-encode, then iteratively
 * lower quality until the data URL is below the target. PNGs with likely
 * transparency are kept as PNG when they already fit, otherwise re-encoded
 * as JPEG (transparency is acceptable to lose for vision input).
 */
async function compressImageForUpload(file: File): Promise<{ dataUrl: string; bytes: number; mime: string; width: number; height: number }> {
  const bitmap = await loadImageBitmap(file);
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(MIN_IMAGE_DIMENSION, longEdge));
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas context unavailable');
    bitmap.draw(ctx, targetW, targetH);

    // Try a sequence of (mime, quality) pairs from best to worst until we
    // come in under the byte budget. Start with the original mime if it's
    // small to begin with; otherwise jump straight to JPEG.
    const attempts: Array<{ mime: string; quality?: number }> = [];
    if (file.type === 'image/png' || file.type === 'image/webp') {
      attempts.push({ mime: file.type });
    }
    for (const q of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42]) {
      attempts.push({ mime: 'image/jpeg', quality: q });
    }

    let best: { dataUrl: string; bytes: number; mime: string } | null = null;
    for (const { mime, quality } of attempts) {
      const out = canvas.toDataURL(mime, quality);
      const bytes = approxDataUrlBytes(out);
      if (!best || bytes < best.bytes) best = { dataUrl: out, bytes, mime };
      if (bytes <= TARGET_IMAGE_BYTES) {
        return { dataUrl: out, bytes, mime, width: targetW, height: targetH };
      }
    }

    // Even at the lowest quality we couldn't get under the budget — try
    // halving the dimensions once and retry the worst-case JPEG quality.
    const halfW = Math.max(1, Math.round(targetW / 2));
    const halfH = Math.max(1, Math.round(targetH / 2));
    canvas.width = halfW;
    canvas.height = halfH;
    const ctx2 = canvas.getContext('2d');
    if (ctx2) {
      bitmap.draw(ctx2, halfW, halfH);
      const out = canvas.toDataURL('image/jpeg', 0.7);
      const bytes = approxDataUrlBytes(out);
      if (!best || bytes < best.bytes) best = { dataUrl: out, bytes, mime: 'image/jpeg' };
      if (bytes <= TARGET_IMAGE_BYTES) {
        return { dataUrl: out, bytes, mime: 'image/jpeg', width: halfW, height: halfH };
      }
    }

    if (!best) throw new Error('image encode failed');
    // Return whatever was smallest — the caller decides whether to error out.
    return { dataUrl: best.dataUrl, bytes: best.bytes, mime: best.mime, width: targetW, height: targetH };
  } finally {
    bitmap.close();
  }
}

async function parseOnServer(file: File): Promise<{ text: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/deck/uploads/parse', { method: 'POST', body: form });
  if (!res.ok) {
    let msg = `Server parse failed (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      const text = await res.text().catch(() => '');
      if (text) msg = text;
    }
    throw new Error(msg);
  }
  const body = await res.json();
  return { text: String(body.text || '') };
}

export interface AttachmentItem extends DeckAttachment {
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `att_${Date.now().toString(36)}_${counter}`;
}

function formatLimit(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export async function ingestFile(file: File): Promise<AttachmentItem> {
  const id = nextId();
  const base = {
    id,
    name: file.name || 'upload',
    mime: file.type || 'application/octet-stream',
    size: file.size,
  };

  if (file.size > MAX_FILE_SIZE) {
    return { ...base, kind: 'text', status: 'error', error: `File exceeds ${formatLimit(MAX_FILE_SIZE)} limit` };
  }

  const cls = classify(file);

  if (cls === 'image') {
    if (file.size > MAX_IMAGE_SIZE) {
      return { ...base, kind: 'image', status: 'error', error: `Image exceeds ${formatLimit(MAX_IMAGE_SIZE)} limit` };
    }
    try {
      // Hermes API Server caps request bodies at 1 MB, so we compress the
      // image client-side before it ever leaves the browser. If compression
      // still can't fit it, fail loudly here rather than letting the server
      // 413 silently while the agent gets nothing.
      const compressed = await compressImageForUpload(file);
      if (compressed.bytes > TARGET_IMAGE_BYTES * 1.5) {
        return {
          ...base,
          kind: 'image',
          status: 'error',
          error: `Image still exceeds ${formatLimit(TARGET_IMAGE_BYTES)} after compression — cannot upload`,
        };
      }
      return {
        ...base,
        mime: compressed.mime,
        size: compressed.bytes,
        kind: 'image',
        status: 'ready',
        dataUrl: compressed.dataUrl,
      };
    } catch (e) {
      return { ...base, kind: 'image', status: 'error', error: e instanceof Error ? e.message : 'Read failed' };
    }
  }

  if (cls === 'text') {
    try {
      const text = await readAsText(file);
      return { ...base, kind: 'text', status: 'ready', text };
    } catch (e) {
      return { ...base, kind: 'text', status: 'error', error: e instanceof Error ? e.message : 'Read failed' };
    }
  }

  if (cls === 'pdf' || cls === 'docx') {
    try {
      const r = await parseOnServer(file);
      return { ...base, kind: 'text', status: 'ready', text: r.text };
    } catch (e) {
      return { ...base, kind: 'text', status: 'error', error: e instanceof Error ? e.message : 'Parse failed' };
    }
  }

  return { ...base, kind: 'text', status: 'error', error: 'Unsupported file type' };
}

export function ingestPastedText(rawText: string, label = 'Pasted'): AttachmentItem {
  const text = clipText(rawText);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `${label}-${stamp}.txt`;
  return {
    id: nextId(),
    name,
    mime: 'text/plain',
    size: new Blob([rawText]).size,
    kind: 'text',
    status: 'ready',
    text,
  };
}

export function attachmentToPayload(item: AttachmentItem): DeckAttachment {
  if (item.kind === 'image') {
    return {
      id: item.id,
      name: item.name,
      mime: item.mime,
      size: item.size,
      kind: 'image',
      dataUrl: item.dataUrl,
    };
  }
  return {
    id: item.id,
    name: item.name,
    mime: item.mime,
    size: item.size,
    kind: 'text',
    text: item.text,
  };
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
