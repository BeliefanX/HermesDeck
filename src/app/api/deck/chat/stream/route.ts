import { NextRequest } from 'next/server';
import { createChatStream } from '@/lib/server/hermes';
export const dynamic='force-dynamic';
export async function POST(req: NextRequest){ const body = await req.json().catch(()=>({})); return new Response(createChatStream(body), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } }); }
