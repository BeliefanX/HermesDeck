import type { ToolSummary } from '@/lib/types';
import { makeCache } from './core';

async function getToolsUncached(): Promise<ToolSummary[]> {
  throw new Error('getTools: Hermes Agent API does not currently expose a tools/skills registry endpoint required by HermesDeck. Direct Hermes CLI and local skill indexing are disabled for user-facing runtime routes.');
}

export const getTools = makeCache(10_000, getToolsUncached);
