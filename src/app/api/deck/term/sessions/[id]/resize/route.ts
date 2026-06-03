import { NextRequest, NextResponse } from 'next/server';
import { resizeSession } from '@/lib/server/terminal-pty';
import { guardMutating, guardRequestBody, readLimitedJson } from '@/lib/server/csrf';
import { requireAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  try {
    const { id } = await params;
    const parsed = await readLimitedJson<{ cols?: unknown; rows?: unknown }>(req, 16_000, {});
    if (!parsed.ok) return parsed.response;
    resizeSession(id, Number(parsed.value?.cols), Number(parsed.value?.rows));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
