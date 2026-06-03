import { NextRequest, NextResponse } from 'next/server';
import { getTools } from '@/lib/server/hermes';
import { requireActiveUser } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  try {
    const tools = await getTools();
    return NextResponse.json(
      { tools },
      { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { tools: [], error: 'tools_fetch_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
