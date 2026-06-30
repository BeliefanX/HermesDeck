import { NextResponse } from 'next/server';
import { getRuns } from '@/lib/server/hermes';
import { profileScopeForUser, requireActiveUser } from '@/lib/server/rbac';
import type { DeckRun } from '@/lib/types';
import { isKnownUnavailableError, statusForUnexpectedError } from '../_unavailable';

export const dynamic = 'force-dynamic';

const PROFILE_ID_RE = /^[\w.-]{1,64}$/;

export async function GET(req: Request) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const profile = url.searchParams.get('profile') || undefined;
  if (profile && !PROFILE_ID_RE.test(profile)) {
    return NextResponse.json({ runs: [], error: 'invalid_profile' }, { status: 400 });
  }
  const scope = profileScopeForUser(auth.user, profile);
  if (!scope.ok) return scope.response;
  try {
    const runs: DeckRun[] = scope.profiles.length
      ? (await Promise.all(scope.profiles.map((profileId) => getRuns(profileId))))
        .flat()
        .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
        .slice(0, 80)
      : await getRuns(profile);
    return NextResponse.json(
      { runs },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=20' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isKnownUnavailableError(err)) {
      return NextResponse.json({ error: 'runs_failed', detail: msg.slice(0, 200) }, { status: statusForUnexpectedError(err) });
    }
    return NextResponse.json(
      { runs: [], unavailableReason: msg.slice(0, 200) },
      { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' } },
    );
  }
}
