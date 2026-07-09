import type { DeckModelConfig } from '@/lib/types';

// ponytail: Dashboard owns profile selection via ?profile; Deck has one explicit control-plane base.
const DASHBOARD_BASE = (process.env.HERMES_DASHBOARD_BASE || 'http://127.0.0.1:9119').replace(/\/+$/, '');
const DASHBOARD_SESSION_TOKEN = process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim();
const DASHBOARD_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function dashboardHeaders(): Record<string, string> | undefined {
  try {
    // ponytail: exact WHATWG host matching prevents token disclosure to lookalike remote bases.
    return DASHBOARD_SESSION_TOKEN && DASHBOARD_LOOPBACK_HOSTS.has(new URL(DASHBOARD_BASE).hostname)
      ? { 'X-Hermes-Session-Token': DASHBOARD_SESSION_TOKEN }
      : undefined;
  } catch {
    return undefined;
  }
}

type Json = Record<string, unknown>;
type Result = { value?: unknown; error?: string };

function record(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function baseUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

async function get(path: string, profileId: string): Promise<Result> {
  const url = new URL(`${DASHBOARD_BASE}${path}`);
  url.searchParams.set('profile', profileId);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: dashboardHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { error: `${path} returned HTTP ${response.status}` };
    return { value: await response.json() };
  } catch {
    return { error: `${path} is unavailable` };
  }
}

export async function getDashboardModelConfig(profileId: string): Promise<DeckModelConfig> {
  const [infoResult, auxiliaryResult, configResult, cronResult] = await Promise.all([
    get('/api/model/info', profileId),
    get('/api/model/auxiliary', profileId),
    get('/api/config', profileId),
    get('/api/cron/jobs', profileId),
  ]);
  const errors = Object.fromEntries([
    ['info', infoResult.error], ['auxiliary', auxiliaryResult.error], ['delegation', configResult.error], ['cron', cronResult.error],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])));
  const info = record(infoResult.value) || {};
  const auxiliary = record(auxiliaryResult.value) || {};
  const config = record(configResult.value) || {};
  const caps = record(info.capabilities) || {};
  const delegation = record(config.delegation);
  const jobs = Array.isArray(cronResult.value) ? cronResult.value : (record(cronResult.value)?.jobs as unknown[] || []);

  return {
    profileId,
    available: !infoResult.error,
    main: {
      model: text(info.model), provider: text(info.provider),
      autoContextLength: number(info.auto_context_length), configContextLength: number(info.config_context_length),
      effectiveContextLength: number(info.effective_context_length),
      capabilities: {
        supportsTools: typeof caps.supports_tools === 'boolean' ? caps.supports_tools : undefined,
        supportsVision: typeof caps.supports_vision === 'boolean' ? caps.supports_vision : undefined,
        supportsReasoning: typeof caps.supports_reasoning === 'boolean' ? caps.supports_reasoning : undefined,
        contextWindow: number(caps.context_window), maxOutputTokens: number(caps.max_output_tokens), modelFamily: text(caps.model_family),
      },
    },
    delegation: delegation ? { model: text(delegation.model), provider: text(delegation.provider), baseUrl: baseUrl(delegation.base_url), reasoningEffort: text(delegation.reasoning_effort) } : undefined,
    auxiliary: (Array.isArray(auxiliary.tasks) ? auxiliary.tasks : []).map(record).filter((task): task is Json => Boolean(task)).map((task) => ({ task: text(task.task) || 'unknown', model: text(task.model), provider: text(task.provider), baseUrl: baseUrl(task.base_url) })),
    cron: jobs.map(record).filter((job): job is Json => Boolean(job)).map((job) => ({ id: text(job.id) || 'unknown', name: text(job.name), model: text(job.model), provider: text(job.provider), baseUrl: baseUrl(job.base_url), modelSnapshot: text(job.model_snapshot), providerSnapshot: text(job.provider_snapshot) })).filter((job) => Boolean(job.model || job.provider || job.modelSnapshot || job.providerSnapshot)),
    errors,
  };
}
