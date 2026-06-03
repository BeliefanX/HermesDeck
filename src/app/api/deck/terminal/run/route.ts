import { NextRequest, NextResponse } from 'next/server';
import { runTerminalAction } from '@/lib/server/hermes';
import { guardMutating, guardRequestBody, readLimitedJson } from '@/lib/server/csrf';
import type { TerminalRunRequest } from '@/lib/types';
import { requireAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 64_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  try {
    const parsed = await readLimitedJson<TerminalRunRequest>(req, 64_000, {} as TerminalRunRequest);
    if (!parsed.ok) return parsed.response;
    const result = await runTerminalAction(parsed.value);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
