import type { DeckRun, DeckRunDetail } from '@/lib/types';

const API_GAP_MESSAGE = 'Hermes Agent API does not currently expose run timeline/detail endpoints required by HermesDeck. Direct local runtime storage reads are disabled.';

export async function getRuns(_profile?: string): Promise<DeckRun[]> {
  throw new Error(`getRuns: ${API_GAP_MESSAGE}`);
}

export async function getRunDetail(_runId: string): Promise<DeckRunDetail | null> {
  throw new Error(`getRunDetail: ${API_GAP_MESSAGE}`);
}
