import type { DeckModelsResponse, ModelInfo } from '@/lib/types';
import { apiHeaders, getHermesApiBase, HERMES_API_BASE, makeKeyedCache } from './core';

const BASE_REASONING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const DEFAULT_REASONING_EFFORT = 'medium';
const HERMES_AGENT_PLACEHOLDER_MODEL = 'hermes agent';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type ApiModelItem = { id: string; provider?: string; isDefault?: boolean; baseUrl?: string };
type ApiProfileRuntime = { id: string; model?: string; provider?: string; reasoningEffort?: string };

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

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeReasoningEffort(value: unknown): string {
  const raw = firstString(value).toLowerCase();
  // Deck resolves Hermes/OpenAI's implicit or "auto" runtime reasoning default
  // to the current composer baseline. If the API starts returning an explicit
  // resolved field, normalizeApiProfileRuntime should pass that through first.
  if (!raw || raw === 'auto') return DEFAULT_REASONING_EFFORT;
  return raw;
}

function extractProfiles(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ['profiles', 'items', 'data']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  if (isRecord(payload.data) && Array.isArray(payload.data.profiles)) return payload.data.profiles;
  return [];
}

function normalizeApiProfileRuntime(raw: unknown): ApiProfileRuntime | null {
  if (!isRecord(raw)) return null;
  const id = firstString(raw.id, raw.profile_id, raw.profileId, raw.name);
  if (!id) return null;
  const agent = isRecord(raw.agent) ? raw.agent : undefined;
  const model = firstString(raw.model, raw.current_model, raw.currentModel, raw.default_model, raw.defaultModel, agent?.model);
  const provider = firstString(raw.provider, raw.current_provider, raw.currentProvider, raw.default_provider, raw.defaultProvider, agent?.provider);
  const reasoningEffort = normalizeReasoningEffort(
    raw.reasoning_effort
      ?? raw.reasoningEffort
      ?? raw.default_reasoning_effort
      ?? raw.defaultReasoningEffort
      ?? raw.current_reasoning_effort
      ?? raw.currentReasoningEffort
      ?? agent?.reasoning_effort
      ?? agent?.reasoningEffort,
  );
  return { id, model: model || undefined, provider: provider || undefined, reasoningEffort };
}

async function fetchProfileRuntime(profile = 'default'): Promise<ApiProfileRuntime | null> {
  const profileApiBase = getHermesApiBase(profile);
  const bases = Array.from(new Set([profileApiBase, HERMES_API_BASE].filter((base): base is string => Boolean(base))));
  for (const apiBase of bases) {
    const base = apiBase.replace(/\/+$/, '');
    const headerProfile = apiBase === profileApiBase ? profile : 'default';
    for (const path of ['/v1/profiles', '/api/profiles']) {
      try {
        const response = await fetch(`${base}${path}`, {
          cache: 'no-store',
          headers: apiHeaders(headerProfile),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) continue;
        const payload = await response.json().catch(() => null);
        const profiles = extractProfiles(payload)
          .map(normalizeApiProfileRuntime)
          .filter((item): item is ApiProfileRuntime => item !== null);
        const selected = profiles.find((item) => item.id === profile)
          || (profile === 'default' ? profiles.find((item) => item.id === 'default') : undefined);
        if (selected) return selected;
      } catch { /* try the next API profile endpoint */ }
    }
  }
  return null;
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
  const [apiModelItems, profileRuntime] = await Promise.all([
    fetchApiModels(profile),
    fetchProfileRuntime(profile).catch(() => null),
  ]);
  const modelItems = apiModelItems
    .filter((item) => !isHermesAgentPlaceholder(item.provider || 'hermes', item.id, profile));

  const resolvedModel = profileRuntime?.model?.trim();
  const resolvedProvider = profileRuntime?.provider?.trim() || 'hermes';
  const hasUsableResolvedModel = Boolean(resolvedModel)
    && !isHermesAgentPlaceholder(resolvedProvider, resolvedModel, profile);
  if (hasUsableResolvedModel && resolvedModel && !modelItems.some((item) => item.id === resolvedModel)) {
    modelItems.push({ id: resolvedModel, provider: resolvedProvider, isDefault: true });
  }

  const reasoningEffort = normalizeReasoningEffort(profileRuntime?.reasoningEffort);
  const reasoningLevels = Array.from(new Set([...BASE_REASONING_LEVELS, reasoningEffort]));

  if (!modelItems.length) {
    return {
      providers: [],
      orphanModels: [],
      reasoningEffort,
      reasoningLevels,
    };
  }

  const byProvider = new Map<string, ModelInfo[]>();
  let defaultItem = (resolvedModel ? modelItems.find((item) => item.id === resolvedModel) : undefined)
    || modelItems.find((item) => item.isDefault)
    || modelItems[0];
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
