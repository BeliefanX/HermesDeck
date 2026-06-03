import type { DeckModelsResponse, ModelInfo } from '@/lib/types';
import { apiHeaders, HERMES_API_BASE, makeKeyedCache } from './core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractModelIds(payload: unknown): string[] {
  const rawItems = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : [];
  const ids = rawItems
    .map((item) => (typeof item === 'string' ? item : isRecord(item) && typeof item.id === 'string' ? item.id : ''))
    .map((id) => id.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

async function fetchApiModels(): Promise<string[]> {
  const base = HERMES_API_BASE.replace(/\/+$/, '');
  const response = await fetch(`${base}/v1/models`, {
    cache: 'no-store',
    headers: apiHeaders(),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`/v1/models returned HTTP ${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('/v1/models returned invalid JSON.');
  }
  const ids = extractModelIds(payload);
  if (!ids.length) throw new Error('/v1/models returned no model ids.');
  return ids;
}

async function getModelsUncached(_profile = 'default'): Promise<DeckModelsResponse> {
  const modelIds = await fetchApiModels();
  const models: ModelInfo[] = modelIds.map((id, index) => ({
    id,
    available: true,
    isDefault: index === 0,
  }));
  const defaultModel = models[0]?.id;
  return {
    default: defaultModel ? { provider: 'hermes-agent-api', model: defaultModel } : undefined,
    providers: [{
      id: 'hermes-agent-api',
      name: 'Hermes Agent API',
      isDefault: true,
      credentialCount: undefined,
      models,
    }],
    orphanModels: [],
  };
}

const _getModelsKeyed = makeKeyedCache<string, DeckModelsResponse>(10_000, (profile) => getModelsUncached(profile));
export async function getModels(profile = 'default'): Promise<DeckModelsResponse> {
  return _getModelsKeyed(profile || 'default');
}
