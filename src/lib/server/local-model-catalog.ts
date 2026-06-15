import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type LocalModelCandidate = { provider: string; model: string; baseUrl?: string };

export type LocalModelCatalog = {
  defaultModel?: string;
  defaultProvider?: string;
  defaultBaseUrl?: string;
  reasoningEffort?: string;
  fallbackModels: LocalModelCandidate[];
  providerModels: LocalModelCandidate[];
};

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

function scanLocalModelCatalog(text: string): LocalModelCatalog {
  const result: LocalModelCatalog = { fallbackModels: [], providerModels: [] };
  const lines = text.split(/\r?\n/);
  let top: string | undefined;
  let fallback: Partial<LocalModelCandidate> | undefined;
  let provider: string | undefined;
  let inProviderModels = false;
  let providerModelsIndent = 0;

  const pushFallback = () => {
    if (fallback?.provider && fallback.model) result.fallbackModels.push(fallback as LocalModelCandidate);
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

function mergeLocalModelCatalog(profileCfg: LocalModelCatalog, defaultCfg?: LocalModelCatalog): LocalModelCatalog {
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

export function localModelCatalogForProfile(profile = 'default'): LocalModelCatalog {
  const profileText = readProfileConfigYaml(profile);
  const profileCfg = profileText ? scanLocalModelCatalog(profileText) : { fallbackModels: [], providerModels: [] };
  const defaultText = profile === 'default' ? null : readProfileConfigYaml('default');
  const defaultCfg = defaultText ? scanLocalModelCatalog(defaultText) : undefined;
  return mergeLocalModelCatalog(profileCfg, defaultCfg);
}
