import { NextResponse } from 'next/server';
import { getModels } from '@/lib/server/hermes';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json(await getModels());
}
