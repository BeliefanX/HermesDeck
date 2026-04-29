import { NextResponse } from 'next/server';
import { listTerminalActions } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ actions: listTerminalActions() });
}
