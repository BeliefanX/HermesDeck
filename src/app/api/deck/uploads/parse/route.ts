import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB hard cap on the route
const MAX_TEXT_CHARS = 200_000;

function clipText(text: string) {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_TEXT_CHARS) + `\n\n[…文件内容已截断到 ${MAX_TEXT_CHARS} 字符]`,
    truncated: true,
  };
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError('expected multipart/form-data', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError('missing "file" field', 400);
  if (file.size === 0) return jsonError('empty file', 400);
  if (file.size > MAX_FILE_SIZE) return jsonError(`file exceeds ${MAX_FILE_SIZE} bytes`, 413);

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name || 'upload';
  const lower = name.toLowerCase();
  const mime = file.type || '';

  try {
    if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        const result = await parser.getText();
        const { text, truncated } = clipText(result.text || '');
        return Response.json({
          kind: 'text',
          name,
          mime: mime || 'application/pdf',
          size: buf.length,
          text,
          truncated,
        });
      } finally {
        await parser.destroy().catch(() => {});
      }
    }

    if (lower.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: buf });
      const { text, truncated } = clipText(result.value || '');
      return Response.json({
        kind: 'text',
        name,
        mime: mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buf.length,
        text,
        truncated,
      });
    }

    return jsonError(`unsupported file type: ${mime || lower}`, 415);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(`parse failed: ${msg}`, 500);
  }
}
