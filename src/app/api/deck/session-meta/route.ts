import { NextRequest, NextResponse } from 'next/server';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';
import { getSessionMetaStore, putSessionMetaStore } from '@/lib/server/session-metadata';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 128_000;

function metaResponse(profileId: string, metaStore: ReturnType<typeof getSessionMetaStore>) {
  return NextResponse.json({ ok: true, profileId, metaStore });
}

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const profileId = normalizeProfileId(req.nextUrl.searchParams.get('profileId') || req.nextUrl.searchParams.get('profile'), 'default');
  if (!profileId) return NextResponse.json({ ok: false, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
  if (!access.ok) return access.response;
  return metaResponse(profileId, getSessionMetaStore(auth.user.id, profileId));
}

export async function PUT(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;

  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: MAX_REQUEST_BYTES });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) return parsed.response;

  const profileId = normalizeProfileId(parsed.value.profileId || parsed.value.profile, 'default');
  if (!profileId) return NextResponse.json({ ok: false, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
  if (!access.ok) return access.response;

  const metaStore = putSessionMetaStore(auth.user.id, profileId, parsed.value.metaStore);
  return metaResponse(profileId, metaStore);
}

export const PATCH = PUT;
