import { NextRequest, NextResponse } from 'next/server';
import { hermesApiGet } from '@/lib/server/hermes/core';
import { list, record, text } from '@/lib/server/hermes/deck-agent-api';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profile = normalizeProfileId(req.nextUrl.searchParams.get('profile'), 'default');
  if (!profile) return NextResponse.json({ toolsets: [], error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profile, { fallback: profile });
  if (!access.ok) return access.response;
  try {
    const raw = await hermesApiGet<unknown>('/v1/toolsets', 5000, profile);
    const toolsets = list(raw).map((item) => {
      const row = record(item);
      return {
        name: text(row.name) || '',
        label: text(row.label),
        description: text(row.description),
        enabled: row.enabled !== false,
        configured: row.configured === true,
        tools: Array.isArray(row.tools) ? row.tools.filter((x): x is string => typeof x === 'string') : [],
      };
    }).filter((item) => item.name);
    return NextResponse.json({ profileId: profile, toolsets }, { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ toolsets: [], error: 'toolsets_fetch_failed', detail: msg.slice(0, 200) }, { status: 502 });
  }
}
