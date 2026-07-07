import { NextRequest, NextResponse } from 'next/server';
import { tmuxCommand } from '@/lib/server/terminal-pty';
import { guardMutating, guardRequestBody, readLimitedJson } from '@/lib/server/csrf';
import { requireSuperAdmin } from '@/lib/server/rbac';

type TmuxCommandBody = Parameters<typeof tmuxCommand>[1];

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  try {
    const { id } = await params;
    const parsed = await readLimitedJson<TmuxCommandBody>(req, 16_000, {} as TmuxCommandBody);
    if (!parsed.ok) return parsed.response;
    const result = await tmuxCommand(id, parsed.value);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
