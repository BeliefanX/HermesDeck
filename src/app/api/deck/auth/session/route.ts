import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, getUsername, isBootstrapPassword, verifySessionToken } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const result = verifySessionToken(token);
  if (!result.ok) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
  return NextResponse.json({
    authenticated: true,
    username: getUsername(),
    expiresAt: result.payload.exp,
    bootstrap: isBootstrapPassword(),
  });
}
