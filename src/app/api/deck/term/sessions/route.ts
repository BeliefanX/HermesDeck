import { NextRequest, NextResponse } from 'next/server';
import { createSession, listSessions, liveTerminalEnabled } from '@/lib/server/terminal-pty';
import { guardMutating, requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ enabled: liveTerminalEnabled(), sessions: await listSessions() });
}

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  try {
    const body = await req.json().catch(() => ({}));
    const session = await createSession(body);
    return NextResponse.json({ session });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
