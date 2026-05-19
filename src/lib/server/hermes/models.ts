import type { DeckModelsResponse, ProviderInfo, ModelInfo } from '@/lib/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { runPythonOr } from '../run-python';
import { execFileAsync, makeKeyedCache, resolveHermesProject } from './core';

// ─── Provider / model discovery ────────────────────────────────────
// We combine three signals:
//   1. config.yaml `model.{default,provider,base_url}` → the active default
//   2. `hermes auth list` → which providers have credentials configured
//   3. sessions table aggregation → which provider+model combos have actually
//      been used, plus historical token totals
// The merged view answers "what providers and models does this Hermes have
// access to" without depending on a single canonical registry endpoint.

const PROVIDER_LABELS: Record<string, string> = {
  'openai-codex': 'OpenAI Codex',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'gemini': 'Google Gemini',
  'copilot': 'GitHub Copilot',
  'ollama-cloud': 'Ollama Cloud',
  'ollama': 'Ollama',
  'minimax-cn': 'MiniMax (CN)',
  'openrouter': 'OpenRouter',
  'nous': 'Nous Research',
  'bedrock': 'AWS Bedrock',
  'azure': 'Azure OpenAI',
};

function prettyProvider(id: string): string {
  return PROVIDER_LABELS[id] || id.replace(/(^|[-_])(.)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase());
}

async function listAuthProviders(): Promise<Array<{ id: string; credentialCount: number; authFailed: boolean }>> {
  try {
    const { stdout } = await execFileAsync('hermes', ['auth', 'list'], { timeout: 8000 });
    const out: Array<{ id: string; credentialCount: number; authFailed: boolean }> = [];
    let cur: { id: string; credentialCount: number; authFailed: boolean } | null = null;
    for (const raw of stdout.split(/\r?\n/)) {
      // Provider header line: "openai-codex (1 credentials):"
      const m = raw.match(/^([\w.-]+)\s+\((\d+)\s+credentials?\):/);
      if (m) {
        if (cur) out.push(cur);
        cur = { id: m[1], credentialCount: Number(m[2]) || 0, authFailed: false };
        continue;
      }
      // Credential rows are indented; flag the provider when any credential
      // says "auth failed" so the deck can surface a re-auth hint.
      if (cur && /\bauth failed\b/i.test(raw)) cur.authFailed = true;
    }
    if (cur) out.push(cur);
    return out;
  } catch { return []; }
}

async function getProviderCatalogs(providerIds: string[]): Promise<Record<string, string[]>> {
  if (!providerIds.length) return {};
  const proj = await resolveHermesProject();
  if (!proj) return {};
  // Calls hermes_cli.models.provider_model_ids(provider) for each provider.
  // The function itself decides whether to query a live endpoint or fall back
  // to a curated list, so the deck never touches provider APIs directly.
  const script = String.raw`
import json, os, sys
sys.path.insert(0, os.environ.get('HERMES_PROJECT', ''))
ids = json.loads(os.environ.get('IDS', '[]'))
out = {}
try:
    from hermes_cli.models import provider_model_ids
except Exception:
    print(json.dumps(out)); sys.exit(0)
for pid in ids:
    try:
        out[pid] = list(provider_model_ids(pid) or [])
    except Exception:
        out[pid] = []
print(json.dumps(out, ensure_ascii=False))`;
  return runPythonOr<Record<string, string[]>>(script, {}, {
    bin: proj.pythonBin,
    timeoutMs: 15000,
    env: { ...process.env, HERMES_PROJECT: proj.projectDir, IDS: JSON.stringify(providerIds) },
  });
}

function pickLater(a?: string, b?: string): string | undefined {
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  return a > b ? a : b;
}

function canonicalizeModelId(provider: string, id: string): string {
  // Older Hermes builds appended `:cloud` / `-cloud` to ollama-cloud model ids
  // before the provider was split out. Strip those so historical sessions
  // line up with today's catalog instead of appearing as duplicate aliases.
  if (provider === 'ollama-cloud') {
    return id.replace(/(?::cloud|-cloud)$/i, '');
  }
  return id;
}

async function readDefaultModel(profile = 'default'): Promise<{ provider?: string; model?: string; baseUrl?: string }> {
  // Each profile has its own config.yaml at ~/.hermes/profiles/<id>/config.yaml;
  // the literal "default" profile lives at ~/.hermes/config.yaml. The Profiles
  // page swaps the selected id, so we have to read the matching file or the
  // DEFAULT MODEL panel will silently show the global default for every row.
  const cfgPath = profile && profile !== 'default'
    ? join(homedir(), '.hermes', 'profiles', profile, 'config.yaml')
    : join(homedir(), '.hermes', 'config.yaml');
  try {
    const text = readFileSync(cfgPath, 'utf8');
    // Match the top-level `model:` block (non-greedy, until next top-level key).
    const block = text.match(/^model:\s*\n((?:[ \t]+.*\n?)+)/m);
    if (!block) return {};
    const out: { provider?: string; model?: string; baseUrl?: string } = {};
    for (const line of block[1].split(/\r?\n/)) {
      const m = line.match(/^\s+(\w+):\s*(.+?)\s*$/);
      if (!m) continue;
      const [, key, valRaw] = m;
      const val = valRaw.replace(/^["']|["']$/g, '');
      if (key === 'default') out.model = val;
      else if (key === 'provider') out.provider = val;
      else if (key === 'base_url') out.baseUrl = val;
    }
    return out;
  } catch { return {}; }
}

function readAgentReasoningEffort(profile = 'default'): string | undefined {
  // Reads `agent.reasoning_effort` from the same config.yaml so the chat
  // composer can mirror the configured default instead of pretending it's
  // always "auto".
  const cfgPath = profile && profile !== 'default'
    ? join(homedir(), '.hermes', 'profiles', profile, 'config.yaml')
    : join(homedir(), '.hermes', 'config.yaml');
  try {
    const text = readFileSync(cfgPath, 'utf8');
    const block = text.match(/^agent:\s*\n((?:[ \t]+.*\n?)+)/m);
    if (!block) return undefined;
    for (const line of block[1].split(/\r?\n/)) {
      const m = line.match(/^\s+reasoning_effort:\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim() || undefined;
    }
    return undefined;
  } catch { return undefined; }
}

async function getModelsUncached(profile = 'default'): Promise<DeckModelsResponse> {
  const [auth, def] = await Promise.all([listAuthProviders(), readDefaultModel(profile)]);

  // Resolve the set of providers to ask the catalog for: every provider with
  // credentials, plus the configured default (which may not have an entry in
  // `hermes auth list` if it relies on env-var only).
  const catalogProviders = new Set<string>(auth.map((a) => a.id));
  if (def.provider) catalogProviders.add(def.provider);
  const catalogs = await getProviderCatalogs(Array.from(catalogProviders));

  // Aggregate models actually seen in the selected profile's state.db. Each
  // profile carries its own session history, so the same Hermes install can
  // show different model usage per profile when this is wired through.
  const script = String.raw`
import sqlite3, pathlib, json, datetime, os
profile = os.environ.get('PROFILE', 'default')
home = pathlib.Path.home() / '.hermes'
if profile and profile != 'default':
    home = home / 'profiles' / profile
db = home / 'state.db'
if not db.exists():
    print('[]'); raise SystemExit
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cols = [r[1] for r in con.execute('pragma table_info(sessions)').fetchall()]
need = ['billing_provider','model','input_tokens','output_tokens','started_at']
have = [c for c in need if c in cols]
if 'model' not in have:
    print('[]'); raise SystemExit
sel = ', '.join(have)
rows = con.execute(f'select {sel} from sessions').fetchall()
agg = {}
for r in rows:
    d = dict(r)
    model = d.get('model')
    if not model: continue
    prov = d.get('billing_provider') or ''
    key = (prov, model)
    cur = agg.setdefault(key, {'provider': prov, 'model': model, 'sessions': 0, 'inputTokens': 0, 'outputTokens': 0, 'lastUsed': ''})
    cur['sessions'] += 1
    cur['inputTokens'] += int(d.get('input_tokens') or 0)
    cur['outputTokens'] += int(d.get('output_tokens') or 0)
    raw_ts = d.get('started_at')
    if raw_ts is not None:
        try:
            iso = datetime.datetime.fromtimestamp(float(raw_ts)).isoformat()
        except (TypeError, ValueError):
            iso = str(raw_ts)
        if iso > cur['lastUsed']: cur['lastUsed'] = iso
print(json.dumps(list(agg.values()), ensure_ascii=False))`;

  type Row = { provider: string; model: string; sessions: number; inputTokens: number; outputTokens: number; lastUsed: string };
  const rows = await runPythonOr<Row[]>(script, [], {
    timeoutMs: 10000,
    env: { ...process.env, PROFILE: profile },
  });

  // Build provider buckets from the union of (auth-listed) and (history-seen).
  const byProvider = new Map<string, ProviderInfo>();
  for (const a of auth) {
    byProvider.set(a.id, {
      id: a.id, name: prettyProvider(a.id), credentialCount: a.credentialCount,
      authFailed: a.authFailed || undefined,
      isDefault: a.id === def.provider, baseUrl: a.id === def.provider ? def.baseUrl : undefined,
      models: [],
    });
  }

  // Per-provider model index keyed by canonical id so we can merge catalog
  // entries with usage rows and avoid duplicate `:cloud` aliases.
  const modelIndex = new Map<string, Map<string, ModelInfo>>();
  function bucketFor(providerId: string): Map<string, ModelInfo> {
    let b = modelIndex.get(providerId);
    if (!b) { b = new Map(); modelIndex.set(providerId, b); }
    return b;
  }

  // Seed from the live catalog so models the user can pick are visible even
  // when they've never been used in a session.
  for (const [pid, ids] of Object.entries(catalogs)) {
    const bucket = bucketFor(pid);
    for (const raw of ids) {
      const id = canonicalizeModelId(pid, raw);
      if (!id) continue;
      if (!bucket.has(id)) bucket.set(id, { id, available: true });
      else bucket.set(id, { ...bucket.get(id)!, available: true });
    }
  }

  const orphans: ModelInfo[] = [];
  for (const r of rows) {
    const tokens = r.inputTokens + r.outputTokens;
    const providerId = r.provider;
    const canonical = canonicalizeModelId(providerId, r.model);
    if (!providerId) {
      orphans.push({
        id: canonical,
        sessions: r.sessions,
        tokens,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        lastUsed: r.lastUsed || undefined,
        used: true,
      });
      continue;
    }
    if (!byProvider.has(providerId)) {
      byProvider.set(providerId, { id: providerId, name: prettyProvider(providerId), credentialCount: 0, isDefault: providerId === def.provider, models: [] });
    }
    const bucket = bucketFor(providerId);
    const existing = bucket.get(canonical);
    const merged: ModelInfo = {
      id: canonical,
      available: existing?.available,
      sessions: (existing?.sessions || 0) + r.sessions,
      tokens: (existing?.tokens || 0) + tokens,
      inputTokens: (existing?.inputTokens || 0) + r.inputTokens,
      outputTokens: (existing?.outputTokens || 0) + r.outputTokens,
      lastUsed: pickLater(existing?.lastUsed, r.lastUsed),
      used: true,
    };
    bucket.set(canonical, merged);
  }

  // Make sure the configured default is always present, even if it has no
  // history yet (newly configured Hermes).
  if (def.provider && def.model) {
    if (!byProvider.has(def.provider)) {
      byProvider.set(def.provider, { id: def.provider, name: prettyProvider(def.provider), credentialCount: 0, isDefault: true, baseUrl: def.baseUrl, models: [] });
    } else {
      const cur = byProvider.get(def.provider)!;
      byProvider.set(def.provider, { ...cur, isDefault: true, baseUrl: cur.baseUrl || def.baseUrl });
    }
    const bucket = bucketFor(def.provider);
    const canonical = canonicalizeModelId(def.provider, def.model);
    const existing = bucket.get(canonical);
    bucket.set(canonical, { ...(existing || { id: canonical }), isDefault: true });
  }

  // Materialize models per provider. Keep BOTH used and catalog-only entries
  // so the deck can distinguish "configured capability" from "actually used"
  // (refactor goal 5.3). Sort default first, then by tokens desc, then alpha.
  for (const [pid, p] of byProvider.entries()) {
    const bucket = modelIndex.get(pid);
    const list: ModelInfo[] = bucket ? Array.from(bucket.values()) : [];
    list.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      // Used models above catalog-only.
      const au = a.used ? 1 : 0;
      const bu = b.used ? 1 : 0;
      if (au !== bu) return bu - au;
      const at = a.tokens || 0;
      const bt = b.tokens || 0;
      if (at !== bt) return bt - at;
      return a.id.localeCompare(b.id);
    });
    p.models = list;
  }

  // Keep providers that have credentials OR are the default OR have any model
  // (used or catalog). Provider order: default first, then by used-token total
  // desc, then by name.
  const providers = Array.from(byProvider.values())
    .filter((p) => p.models.length > 0 || (p.credentialCount || 0) > 0 || p.isDefault)
    .sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      const at = a.models.reduce((s, m) => s + (m.tokens || 0), 0);
      const bt = b.models.reduce((s, m) => s + (m.tokens || 0), 0);
      if (at !== bt) return bt - at;
      return a.name.localeCompare(b.name);
    });

  // Suppress orphans entirely — they're confusing in a profile-scoped view and
  // the user explicitly asked to hide them.
  void orphans;

  return {
    default: def.provider && def.model ? { provider: def.provider, model: def.model, baseUrl: def.baseUrl } : undefined,
    providers,
    orphanModels: [],
    reasoningEffort: readAgentReasoningEffort(profile),
  };
}

// Per-profile cached wrapper. The uncached path shells out to `hermes auth list`,
// reads YAML, and runs two Python scripts on every call — far too expensive for
// the dashboard / chat header polling that happens on every interaction.
const _getModelsKeyed = makeKeyedCache<string, DeckModelsResponse>(10_000, (profile) => getModelsUncached(profile));
export async function getModels(profile = 'default'): Promise<DeckModelsResponse> {
  return _getModelsKeyed(profile || 'default');
}
