import type { DeckModelsResponse, ModelInfo } from '@/lib/types';
import { apiHeaders, getHermesApiBase, makeKeyedCache } from './core';

const BASE_REASONING_LEVELS = ['auto', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const HERMES_AGENT_PLACEHOLDER_MODEL = 'hermes agent';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type ApiModelItem = { id: string; provider?: string; isDefault?: boolean; baseUrl?: string };

function extractModelItems(payload: unknown): ApiModelItem[] {
  const rawItems = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : [];
  const seen = new Set<string>();
  const items: ApiModelItem[] = [];
  for (const item of rawItems) {
    const row = isRecord(item) ? item : undefined;
    const id = (typeof item === 'string' ? item : row && typeof row.id === 'string' ? row.id : '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      provider: row && typeof row.provider === 'string' && row.provider.trim()
        ? row.provider.trim()
        : row && typeof row.owned_by === 'string' && row.owned_by.trim()
          ? row.owned_by.trim()
          : undefined,
      isDefault: row?.default === true || row?.is_default === true || row?.isDefault === true,
      baseUrl: row && typeof row.base_url === 'string' ? row.base_url : row && typeof row.baseUrl === 'string' ? row.baseUrl : undefined,
    });
  }
  return items;
}

function isHermesAgentPlaceholder(provider: string | undefined, model: string | undefined, profile = ''): boolean {
  if (provider?.trim().toLowerCase() !== 'hermes') return false;
  const normalizedModel = model?.trim().toLowerCase();
  if (!normalizedModel) return false;
  return normalizedModel === HERMES_AGENT_PLACEHOLDER_MODEL
    || (!!profile && normalizedModel === profile.trim().toLowerCase());
}

async function fetchApiModels(profile = 'default'): Promise<ApiModelItem[]> {
  const apiBase = getHermesApiBase(profile);
  if (!apiBase) throw new Error(`profile '${profile}' has no configured API server base`);
  const base = apiBase.replace(/\/+$/, '');
  const response = await fetch(`${base}/v1/models`, {
    cache: 'no-store',
    headers: apiHeaders(profile),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`/v1/models returned HTTP ${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('/v1/models returned invalid JSON.');
  }
  const items = extractModelItems(payload);
  if (!items.length) throw new Error('/v1/models returned no model ids.');
  return items;
}

async function getModelsUncached(profile = 'default'): Promise<DeckModelsResponse> {
  const modelItems = (await fetchApiModels(profile))
    .filter((item) => !isHermesAgentPlaceholder(item.provider || 'hermes', item.id, profile));

  if (!modelItems.length) {
    return {
      providers: [],
      orphanModels: [],
      reasoningEffort: 'auto',
      reasoningLevels: Array.from(new Set(BASE_REASONING_LEVELS)),
    };
  }

  const byProvider = new Map<string, ModelInfo[]>();
  let defaultItem = modelItems.find((item) => item.isDefault) || modelItems[0];
  for (const item of modelItems) {
    const provider = item.provider || 'hermes';
    const list = byProvider.get(provider) ?? [];
    list.push({ id: item.id, available: true, isDefault: item.id === defaultItem.id });
    byProvider.set(provider, list);
  }

  const providers = Array.from(byProvider.entries()).map(([id, models]) => ({
    id,
    name: id === 'hermes' ? 'Hermes' : id,
    isDefault: id === (defaultItem.provider || 'hermes'),
    credentialCount: undefined,
    baseUrl: modelItems.find((item) => (item.provider || 'hermes') === id)?.baseUrl,
    models,
  }));

  const reasoningEffort = 'auto';
  const reasoningLevels = Array.from(new Set(BASE_REASONING_LEVELS));

  return {
    default: defaultItem ? { provider: defaultItem.provider || 'hermes', model: defaultItem.id, baseUrl: defaultItem.baseUrl } : undefined,
    providers,
    orphanModels: [],
    reasoningEffort,
    reasoningLevels,
  };
}

const _getModelsKeyed = makeKeyedCache<string, DeckModelsResponse>(10_000, (profile) => getModelsUncached(profile));
export async function getModels(profile = 'default'): Promise<DeckModelsResponse> {
  return _getModelsKeyed(profile || 'default');
}
