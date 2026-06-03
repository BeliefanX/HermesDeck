import { NextRequest, NextResponse } from 'next/server';
import {
  getDeckModelPreference,
  updateDeckModelPreference,
} from '@/lib/server/auth';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 16_000;

function preferenceResponse(profileId: string, preference: ReturnType<typeof getDeckModelPreference>) {
  return NextResponse.json({ ok: true, profileId, preference });
}

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;

  const profileId = normalizeProfileId(req.nextUrl.searchParams.get('profileId') || req.nextUrl.searchParams.get('profile'), 'default');
  if (!profileId) return NextResponse.json({ ok: false, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
  if (!access.ok) return access.response;

  return preferenceResponse(profileId, getDeckModelPreference(auth.user.id, profileId));
}

export async function PUT(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;

  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: MAX_REQUEST_BYTES });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, 16_000);
  if (!parsed.ok) return parsed.response;

  const profileId = normalizeProfileId(parsed.value.profileId, 'default');
  if (!profileId) return NextResponse.json({ ok: false, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
  if (!access.ok) return access.response;

  const result = updateDeckModelPreference(auth.user.id, profileId, {
    modelId: parsed.value.modelId,
    modelProvider: parsed.value.modelProvider,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.code, detail: result.error }, { status: result.code === 'not_found' ? 404 : 400 });
  }
  return preferenceResponse(profileId, result.preference);
}

export const PATCH = PUT;
