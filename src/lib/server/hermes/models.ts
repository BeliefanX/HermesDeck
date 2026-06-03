import type { DeckModelsResponse, ModelInfo } from '@/lib/types';
import { apiHeaders, HERMES_API_BASE, makeKeyedCache } from './core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BASE_REASONING_LEVELS = ['auto', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const HERMES_AGENT_PLACEHOLDER_MODEL = 'hermes agent';

type ModelCandidate = { provider: string; model: string; baseUrl?: string };
type ScannedModelConfig = {
  defaultModel?: string;
  defaultProvider?: string;
  defaultBaseUrl?: string;
  reasoningEffort?: string;
  fallbackModels: ModelCandidate[];
  providerModels: ModelCandidate[];
};

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

function stripYamlComment(raw: string): string {
  let quote: '"' | "'" | '' = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if ((ch === '"' || ch === "'") && raw[i - 1] !== '\\') {
      quote = quote === ch ? '' : quote || ch;
    }
    if (ch === '#' && !quote) return raw.slice(0, i);
  }
  return raw;
}

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '').trim();
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  const m = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
  if (!m) return null;
  return { key: m[1], value: cleanScalar(m[2]) };
}

/** Lightweight YAML scanner — only extracts non-secret model/reasoning catalog keys. */
function scanModelConfig(text: string): ScannedModelConfig {
  const result: ScannedModelConfig = { fallbackModels: [], providerModels: [] };
  const lines = text.split(/\r?\n/);
  let top: string | undefined;
  let fallback: Partial<ModelCandidate> | undefined;
  let provider: string | undefined;
  let inProviderModels = false;
  let providerModelsIndent = 0;

  const pushFallback = () => {
    if (fallback?.provider && fallback.model) result.fallbackModels.push(fallback as ModelCandidate);
  };
  const pushProviderModel = (model: string) => {
    if (provider && model && !['timeout_seconds', 'request_timeout_seconds', 'stale_timeout_seconds'].includes(model)) {
      result.providerModels.push({ provider, model });
    }
  };

  for (const raw of lines) {
    const line = stripYamlComment(raw).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (indent === 0 && !trimmed.startsWith('-')) {
      pushFallback();
      fallback = undefined;
      provider = undefined;
      inProviderModels = false;
      const kv = parseKeyValue(trimmed);
      top = kv?.key;
      continue;
    }

    if (top === 'model') {
      const kv = parseKeyValue(trimmed);
      if (kv?.key === 'default') result.defaultModel = kv.value || undefined;
      if (kv?.key === 'provider') result.defaultProvider = kv.value || undefined;
      if (kv?.key === 'base_url') result.defaultBaseUrl = kv.value || undefined;
      continue;
    }

    if (top === 'agent') {
      const kv = parseKeyValue(trimmed);
      if (kv?.key === 'reasoning_effort') result.reasoningEffort = kv.value.toLowerCase() || undefined;
      continue;
    }

    if (top === 'fallback_providers') {
      const listProvider = trimmed.match(/^-\s*provider:\s*(.+)$/);
      if (listProvider) {
        pushFallback();
        fallback = { provider: cleanScalar(listProvider[1]) };
        continue;
      }
      const kv = parseKeyValue(trimmed.replace(/^-\s*/, ''));
      if (!kv) continue;
      fallback ??= {};
      if (kv.key === 'provider') fallback.provider = kv.value;
      if (kv.key === 'model') fallback.model = kv.value;
      if (kv.key === 'base_url') fallback.baseUrl = kv.value;
      continue;
    }

    if (top === 'providers') {
      if (indent === 2 && !trimmed.startsWith('-')) {
        const kv = parseKeyValue(trimmed);
        provider = kv?.key;
        inProviderModels = false;
        continue;
      }
      if (!provider) continue;
      if (indent === 4 && trimmed === 'models:') {
        inProviderModels = true;
        providerModelsIndent = indent;
        continue;
      }
      if (inProviderModels) {
        if (indent <= providerModelsIndent) {
          inProviderModels = false;
          continue;
        }
        if (indent === providerModelsIndent + 2) {
          const listModel = trimmed.match(/^-\s*(.+)$/);
          if (listModel) {
            pushProviderModel(cleanScalar(listModel[1].replace(/:.*$/, '')));
            continue;
          }
          const kv = parseKeyValue(trimmed);
          if (kv) pushProviderModel(kv.key);
        }
      }
    }
  }
  pushFallback();

  return result;
}

function mergeConfigs(profileCfg: ScannedModelConfig, defaultCfg?: ScannedModelConfig): ScannedModelConfig {
  if (!defaultCfg) return profileCfg;
  return {
    defaultModel: profileCfg.defaultModel ?? defaultCfg.defaultModel,
    defaultProvider: profileCfg.defaultProvider ?? defaultCfg.defaultProvider,
    defaultBaseUrl: profileCfg.defaultBaseUrl ?? defaultCfg.defaultBaseUrl,
    reasoningEffort: profileCfg.reasoningEffort ?? defaultCfg.reasoningEffort,
    fallbackModels: [...profileCfg.fallbackModels, ...defaultCfg.fallbackModels],
    providerModels: [...profileCfg.providerModels, ...defaultCfg.providerModels],
  };
}

function readProfileConfigYaml(profile: string): string | null {
  const base = profile === 'default' ? join(homedir(), '.hermes') : join(homedir(), '.hermes', 'profiles', profile);
  try {
    return readFileSync(join(base, 'config.yaml'), 'utf8');
  } catch {
    return null;
  }
}

async function getModelsUncached(profile = 'default'): Promise<DeckModelsResponse> {
  const modelIds = await fetchApiModels().catch(() => [] as string[]);
  const profileText = readProfileConfigYaml(profile);
  const profileCfg = profileText ? scanModelConfig(profileText) : { fallbackModels: [], providerModels: [] };
  const defaultText = profile === 'default' ? null : readProfileConfigYaml('default');
  const defaultCfg = defaultText ? scanModelConfig(defaultText) : undefined;
  const cfg = mergeConfigs(profileCfg, defaultCfg);

  // Build a deduplicated list of (modelId, provider, isDefault)
  const seen = new Map<string, { provider: string; isDefault: boolean; baseUrl?: string }>();

  // 1) Config default model
  if (cfg.defaultModel && cfg.defaultProvider && !isHermesAgentPlaceholder(cfg.defaultProvider, cfg.defaultModel)) {
    seen.set(cfg.defaultModel, { provider: cfg.defaultProvider, isDefault: true, baseUrl: cfg.defaultBaseUrl });
  }

  // 2) Configured provider catalog and fallback provider models
  for (const fb of [...cfg.providerModels, ...cfg.fallbackModels]) {
    if (!isHermesAgentPlaceholder(fb.provider, fb.model) && !seen.has(fb.model)) {
      seen.set(fb.model, { provider: fb.provider, isDefault: false, baseUrl: fb.baseUrl });
    }
  }

  // 3) API-returned models. Hermes Agent returns a synthetic `Hermes Agent`
  // placeholder from /v1/models; keep it internal and never expose it as a
  // composer-selectable candidate.
  for (const id of modelIds) {
    if (!isHermesAgentPlaceholder('hermes', id) && !seen.has(id)) {
      seen.set(id, { provider: 'hermes', isDefault: seen.size === 0 });
    }
  }

  // Group by provider for the DeckModelsResponse shape
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
  let defaultProvider: string = defaultModel ? seen.get(defaultModel)?.provider ?? 'hermes' : providers[0]?.id ?? 'hermes';
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
