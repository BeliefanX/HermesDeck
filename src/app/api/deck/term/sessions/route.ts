import { NextRequest, NextResponse } from 'next/server';
import { createSession, listSessions, liveTerminalEnabled } from '@/lib/server/terminal-pty';
import { guardMutating, guardRequestBody, readLimitedJson } from '@/lib/server/csrf';
import { requireAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ enabled: liveTerminalEnabled(), sessions: await listSessions() });
}

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  try {
    const parsed = await readLimitedJson(req, 16_000, {});
    if (!parsed.ok) return parsed.response;
    const session = await createSession(parsed.value);
    return NextResponse.json({ session });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
