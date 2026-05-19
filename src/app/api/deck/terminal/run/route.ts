import { NextRequest, NextResponse } from 'next/server';
import { runTerminalAction } from '@/lib/server/hermes';
import { guardMutating } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  try {
    const body = await req.json().catch(() => ({}));
    const result = await runTerminalAction(body);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
