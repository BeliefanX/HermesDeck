function formatAttachmentBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export interface NormalizedAttachment {
  name: string;
  mime: string;
  size: number;
  kind: 'text' | 'image' | 'file';
  text?: string;
  dataUrl?: string;
}

export function normalizeAttachments(input: unknown): NormalizedAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: NormalizedAttachment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const kind = a.kind === 'image' ? 'image' : a.kind === 'text' ? 'text' : a.kind === 'file' ? 'file' : null;
    if (!kind) continue;
    const name = typeof a.name === 'string' ? a.name : 'attachment';
    const mime = typeof a.mime === 'string' ? a.mime : '';
    const size = typeof a.size === 'number' ? a.size : 0;
    if (kind === 'text' && typeof a.text === 'string' && a.text.trim()) {
      out.push({ kind, name, mime, size, text: a.text });
    } else if (kind === 'image' && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:')) {
      out.push({ kind, name, mime, size, dataUrl: a.dataUrl });
    }
    // Note: `file` kind is only consumed for *outbound* persistence/round-tripping
    // for now. We don't forward generic binary file uploads to the upstream Hermes
    // /v1/responses input, so we don't push them here.
  }
  return out;
}

export function buildPromptWithAttachments(message: string, atts: NormalizedAttachment[]): string {
  const textAtts = atts.filter((a) => a.kind === 'text');
  if (!textAtts.length) return message;
  const blocks = textAtts.map((a) => {
    const header = `Attached file: ${a.name} (${a.mime || 'unknown'}, ${formatAttachmentBytes(a.size)})`;
    return `<<<<<< ${header}\n${a.text}\n>>>>>> end of ${a.name}`;
  });
  // Annotate image attachments as text hints too — useful when the model is
  // not multimodal but we still want it to know an image was attached.
  const imageAtts = atts.filter((a) => a.kind === 'image');
  const imageHints = imageAtts.map(
    (a) => `Attached image: ${a.name} (${a.mime || 'image/*'}, ${formatAttachmentBytes(a.size)})`,
  );
  const prefix = [...blocks, ...imageHints].join('\n\n');
  return prefix + (message ? '\n\n' + message : '');
}

// ─── AI-emitted attachment extraction ───────────────────────────────
//
// The Hermes /v1/responses stream multiplexes text deltas, tool events, and
// (for image-generation tools or multimodal models) image artifacts. The
// upstream OpenAI Responses event vocabulary uses several distinct shapes:
//
//   • `response.image_generation_call.partial_image` → { partial_image_b64, output_format }
//   • `response.image_generation_call.completed`     → may carry `result` (b64)
//   • `response.output_item.done` with item.type === 'image_generation_call'
//     and item.result containing the final base64 payload
//   • Inline message content parts of type `output_image` / `image` /
//     `image_url` / `input_image` carrying an image_url object or a b64 buffer
//   • Tool calls returning artifacts shaped as
//     { type:'image', image_url:'data:...'} or
//     { type:'file', file: { url, name, mime } }
//
// We pluck any of these into a uniform DeckAttachment shape so the chat UI
// can render them as proper attachment chips without each renderer needing to
// know upstream's exact event vocabulary.

export interface EmittedAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'file';
  dataUrl?: string;
  url?: string;
}

function inferMimeFromName(name: string, fallback = 'application/octet-stream'): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  if (!m) return fallback;
  const ext = m[1].toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'pdf') return 'application/pdf';
  return fallback;
}

function approxBase64Size(b64: string): number {
  // Strip optional data URL prefix when callers hand us the whole thing.
  const comma = b64.indexOf(',');
  const body = comma >= 0 ? b64.slice(comma + 1) : b64;
  return Math.floor(body.length * 3 / 4);
}

function makeAttachmentId(seed: string): string {
  // Deterministic-ish so repeated emissions of the same partial frame collapse.
  return `att_${seed.slice(0, 12)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Walk an arbitrary parsed SSE event and pull out any image / file artifacts. */
export function extractAttachmentsFromEvent(obj: unknown): EmittedAttachment[] {
  if (!obj || typeof obj !== 'object') return [];
  const out: EmittedAttachment[] = [];
  const seen = new Set<string>();
  const push = (att: EmittedAttachment) => {
    const key = att.dataUrl ? att.dataUrl.slice(0, 64) + att.size : att.url || att.name;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(att);
  };

  const visit = (node: unknown, hint?: { name?: string; mime?: string }) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => visit(n, hint)); return; }
    const n = node as Record<string, unknown>;
    const type = typeof n.type === 'string' ? n.type : '';

    // Direct image content parts: { type: 'output_image' | 'image' | 'input_image', image_url: ... }
    if (type === 'output_image' || type === 'image' || type === 'input_image' || type === 'image_url') {
      const iu = n.image_url;
      let url: string | undefined;
      if (typeof iu === 'string') url = iu;
      else if (iu && typeof iu === 'object' && typeof (iu as { url?: unknown }).url === 'string') url = (iu as { url: string }).url;
      if (!url && typeof n.url === 'string') url = n.url;
      // Some providers include a separate b64 field.
      const b64 = typeof n.b64_json === 'string' ? n.b64_json
        : typeof (n as { image_b64?: unknown }).image_b64 === 'string' ? (n as { image_b64: string }).image_b64
        : undefined;
      const fmt = typeof (n as { output_format?: unknown }).output_format === 'string' ? String((n as { output_format: string }).output_format) : '';
      const mime = (typeof n.mime === 'string' && n.mime) || (typeof n.mime_type === 'string' && (n as { mime_type: string }).mime_type)
        || (fmt ? `image/${fmt}` : '')
        || hint?.mime
        || 'image/png';
      const name = (typeof n.name === 'string' && n.name) || hint?.name || `image.${(mime.split('/')[1] || 'png').replace('+xml','')}`;
      if (url && url.startsWith('data:')) {
        push({ id: makeAttachmentId(url), name, mime, size: approxBase64Size(url), kind: 'image', dataUrl: url });
      } else if (url) {
        push({ id: makeAttachmentId(url), name, mime, size: 0, kind: 'image', url });
      } else if (b64) {
        const dataUrl = `data:${mime};base64,${b64}`;
        push({ id: makeAttachmentId(b64), name, mime, size: approxBase64Size(b64), kind: 'image', dataUrl });
      }
      return;
    }

    // image_generation_call partial / completed events from the Responses API.
    if (type === 'response.image_generation_call.partial_image'
        || type === 'response.image_generation_call.completed'
        || type === 'image_generation_call') {
      const b64 = typeof n.partial_image_b64 === 'string' ? n.partial_image_b64
        : typeof (n as { result?: unknown }).result === 'string' ? (n as { result: string }).result
        : typeof n.b64_json === 'string' ? n.b64_json
        : undefined;
      const fmt = typeof (n as { output_format?: unknown }).output_format === 'string' ? String((n as { output_format: string }).output_format) : 'png';
      const mime = `image/${fmt}`;
      if (b64) {
        const dataUrl = `data:${mime};base64,${b64}`;
        push({ id: makeAttachmentId(b64), name: `generated.${fmt}`, mime, size: approxBase64Size(b64), kind: 'image', dataUrl });
      }
    }

    // Output items wrapping image_generation_call
    if (type === 'response.output_item.done' || type === 'response.output_item.added' || (n as { item?: unknown }).item) {
      visit((n as { item?: unknown }).item, hint);
    }

    // File-style content parts: { type: 'file' | 'output_file', file: { url, name, mime } } or
    // { type: 'output_file', file_id, filename, mime_type }
    if (type === 'file' || type === 'output_file' || type === 'input_file') {
      const fileObj = (n.file && typeof n.file === 'object') ? n.file as Record<string, unknown> : n;
      const url = typeof fileObj.url === 'string' ? fileObj.url
        : typeof (n as { url?: unknown }).url === 'string' ? (n as { url: string }).url
        : undefined;
      const dataUrl = typeof fileObj.dataUrl === 'string' && (fileObj.dataUrl as string).startsWith('data:')
        ? fileObj.dataUrl as string
        : undefined;
      const mime = typeof fileObj.mime === 'string' ? fileObj.mime
        : typeof (fileObj as { mime_type?: unknown }).mime_type === 'string' ? (fileObj as { mime_type: string }).mime_type
        : '';
      const name = typeof fileObj.name === 'string' ? fileObj.name
        : typeof (fileObj as { filename?: unknown }).filename === 'string' ? (fileObj as { filename: string }).filename
        : 'file';
      const resolvedMime = mime || inferMimeFromName(name);
      const isImage = resolvedMime.startsWith('image/');
      if (dataUrl) {
        push({ id: makeAttachmentId(dataUrl), name, mime: resolvedMime, size: approxBase64Size(dataUrl), kind: isImage ? 'image' : 'file', dataUrl });
      } else if (url) {
        push({ id: makeAttachmentId(url), name, mime: resolvedMime, size: 0, kind: isImage ? 'image' : 'file', url });
      }
      return;
    }

    // Recurse into common nested shapes.
    for (const key of ['delta', 'part', 'item', 'response', 'message', 'content', 'output', 'parts', 'arguments', 'result', 'tool_calls', 'choices']) {
      if (key in n) visit((n as Record<string, unknown>)[key], hint);
    }
  };

  visit(obj);
  return out;
}
