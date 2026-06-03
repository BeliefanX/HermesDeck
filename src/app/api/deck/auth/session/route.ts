import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, isBootstrapPassword, toSafeUserContext, verifySessionToken } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const result = verifySessionToken(token);
  if (!result.ok) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
  const user = toSafeUserContext(result.user);
  return NextResponse.json({
    authenticated: true,
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    assignedProfileIds: user.assignedProfileIds,
    capabilities: user.capabilities,
    user,
    expiresAt: result.payload.exp,
    bootstrap: isBootstrapPassword(result.user.id),
  });
}
