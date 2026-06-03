import type { DeckModelsResponse, ModelInfo } from '@/lib/types';
import { apiHeaders, HERMES_API_BASE, makeKeyedCache } from './core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

/** Lightweight YAML scanner — only extracts model-related keys. */
function scanModelConfig(text: string): { defaultModel?: string; defaultProvider?: string; fallbackModels: Array<{ provider: string; model: string }> } {
  const lines = text.split(/\r?\n/);
  let inModel = false;
  let inFallback = false;
  let fallbackIndent = 0;
  let currentProvider: string | undefined;

  const result: { defaultModel?: string; defaultProvider?: string; fallbackModels: Array<{ provider: string; model: string }> } = { fallbackModels: [] };

  for (const raw of lines) {
    const line = raw.replace(/#.*/, ''); // strip comments
    const m = line.match(/^(\s*)(\S+):\s*(.*)/);
    if (!m) {
      // list item under fallback_providers
      if (inFallback) {
        const indent = (line.match(/^(\s*)/)?.[1] ?? '').length;
        if (indent <= fallbackIndent && line.trim()) {
          inFallback = false;
          continue;
        }
        const prov = line.match(/^\s+-?\s*provider:\s*(\S+)/)?.[1];
        const mod = line.match(/^\s+-?\s*model:\s*(\S+)/)?.[1];
        if (prov) currentProvider = prov;
        if (mod && currentProvider) {
          result.fallbackModels.push({ provider: currentProvider, model: mod });
        }
      }
      continue;
    }
    const indent = m[1].length;
    const key = m[2];
    const val = m[3].trim().replace(/^['"]|['"]$/g, '');

    if (key === 'model') {
      inModel = true;
      inFallback = false;
      continue;
    }
    if (key === 'providers') {
      inModel = false;
      inFallback = false;
      continue;
    }
    if (key === 'fallback_providers') {
      inFallback = true;
      inModel = false;
      fallbackIndent = indent;
      continue;
    }

    if (inModel) {
      if (key === 'default') result.defaultModel = val || undefined;
      if (key === 'provider') result.defaultProvider = val || undefined;
    }

    if (inFallback) {
      if (indent <= fallbackIndent && line.trim() && !line.match(/^\s*-/)) {
        inFallback = false;
        continue;
      }
      if (key === 'provider') currentProvider = val || undefined;
      if (key === 'model' && currentProvider) {
        result.fallbackModels.push({ provider: currentProvider, model: val });
      }
    }
  }

  return result;
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
  const cfgText = readProfileConfigYaml(profile);
  const cfg = cfgText ? scanModelConfig(cfgText) : { fallbackModels: [] };

  // Build a deduplicated list of (modelId, provider, isDefault)
  const seen = new Map<string, { provider: string; isDefault: boolean }>();

  // 1) Config default model
  if (cfg.defaultModel && cfg.defaultProvider) {
    seen.set(cfg.defaultModel, { provider: cfg.defaultProvider, isDefault: true });
  }

  // 2) Fallback provider models
  for (const fb of cfg.fallbackModels) {
    if (!seen.has(fb.model)) {
      seen.set(fb.model, { provider: fb.provider, isDefault: false });
    }
  }

  // 3) API-returned models
  for (const id of modelIds) {
    if (!seen.has(id)) {
      seen.set(id, { provider: 'hermes', isDefault: seen.size === 0 });
    }
  }

  // 4) If still empty, add a safe fallback
  if (seen.size === 0) {
    seen.set('Hermes Agent', { provider: 'hermes', isDefault: true });
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

  const defaultModel = cfg.defaultModel ?? Array.from(seen.keys())[0];
  const defaultProvider = cfg.defaultProvider ?? providers[0]?.id ?? 'hermes';

  return {
    default: defaultModel ? { provider: defaultProvider, model: defaultModel } : undefined,
    providers,
    orphanModels: [],
  };
}

const _getModelsKeyed = makeKeyedCache<string, DeckModelsResponse>(10_000, (profile) => getModelsUncached(profile));
export async function getModels(profile = 'default'): Promise<DeckModelsResponse> {
  return _getModelsKeyed(profile || 'default');
}
