import { NextRequest, NextResponse } from 'next/server';
import { getRunDetail } from '@/lib/server/hermes';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const run = await getRunDetail(id);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json(run);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'run_detail_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
