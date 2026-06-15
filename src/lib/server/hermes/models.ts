import type { DeckModelsResponse, ModelInfo } from '@/lib/types';
import { localModelCatalogForProfile } from '@/lib/server/local-model-catalog';
import { apiHeaders, getHermesApiBase, makeKeyedCache } from './core';

const BASE_REASONING_LEVELS = ['auto', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const HERMES_AGENT_PLACEHOLDER_MODEL = 'hermes agent';

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

function isHermesAgentPlaceholder(provider: string | undefined, model: string | undefined): boolean {
  return provider?.trim().toLowerCase() === 'hermes' && model?.trim().toLowerCase() === HERMES_AGENT_PLACEHOLDER_MODEL;
}

async function fetchApiModels(profile = 'default'): Promise<string[]> {
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
  const ids = extractModelIds(payload);
  if (!ids.length) throw new Error('/v1/models returned no model ids.');
  return ids;
}

async function getModelsUncached(profile = 'default'): Promise<DeckModelsResponse> {
  const modelIds = await fetchApiModels(profile);
  const cfg = localModelCatalogForProfile(profile);
  const seen = new Map<string, { provider: string; isDefault: boolean; baseUrl?: string }>();

  if (cfg.defaultModel && cfg.defaultProvider && !isHermesAgentPlaceholder(cfg.defaultProvider, cfg.defaultModel)) {
    seen.set(cfg.defaultModel, { provider: cfg.defaultProvider, isDefault: true, baseUrl: cfg.defaultBaseUrl });
  }

  for (const candidate of [...cfg.providerModels, ...cfg.fallbackModels]) {
    if (!isHermesAgentPlaceholder(candidate.provider, candidate.model) && !seen.has(candidate.model)) {
      seen.set(candidate.model, { provider: candidate.provider, isDefault: false, baseUrl: candidate.baseUrl });
    }
  }

  for (const id of modelIds) {
    if (!isHermesAgentPlaceholder('hermes', id) && !seen.has(id)) {
      seen.set(id, { provider: 'hermes', isDefault: seen.size === 0 });
    }
  }

  if (!seen.size) {
    throw new Error('/v1/models returned no selectable profile models.');
  }

  const byProvider = new Map<string, ModelInfo[]>();
  for (const [id, meta] of seen) {
    const list = byProvider.get(meta.provider) ?? [];
    list.push({ id, available: true, isDefault: meta.isDefault });
    byProvider.set(meta.provider, list);
  }

  const providers = Array.from(byProvider.entries()).map(([id, models], idx) => ({
    id,
    name: id === 'hermes' ? 'Hermes' : id,
    isDefault: idx === 0,
    credentialCount: undefined,
    models,
  }));

  let defaultModel: string | undefined = Array.from(seen.keys())[0];
  let defaultProvider = defaultModel ? seen.get(defaultModel)?.provider ?? 'hermes' : providers[0]?.id ?? 'hermes';
  let defaultBaseUrl = defaultModel ? seen.get(defaultModel)?.baseUrl : undefined;
  if (cfg.defaultModel && cfg.defaultProvider && !isHermesAgentPlaceholder(cfg.defaultProvider, cfg.defaultModel)) {
    defaultModel = cfg.defaultModel;
    defaultProvider = cfg.defaultProvider;
    defaultBaseUrl = cfg.defaultBaseUrl;
  }
  const reasoningEffort = cfg.reasoningEffort || 'auto';
  const reasoningLevels = Array.from(new Set([...BASE_REASONING_LEVELS, reasoningEffort].filter(Boolean)));

  return {
    default: defaultModel ? { provider: defaultProvider, model: defaultModel, baseUrl: defaultBaseUrl } : undefined,
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
