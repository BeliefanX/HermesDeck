import type { TokenStats } from '@/lib/types';

export async function getTokenStats(_days = 14): Promise<TokenStats> {
  throw new Error('getTokenStats: Hermes Agent API does not currently expose token analytics required by HermesDeck. Direct local runtime storage reads are disabled.');
}
