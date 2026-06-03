import type { DeckHealth } from '@/lib/types';
import { makeCache, apiHeaders, HERMES_API_BASE, HERMES_DASHBOARD_BASE, startedAt, redactSecrets } from './core';

function exposeBaseUrl(url: string): string {
  if (process.env.NODE_ENV !== 'production' || process.env.HERMESDECK_DEBUG_HEALTH === '1') return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? 'localhost' : u.hostname}${u.port ? ':<redacted>' : ''}`;
  } catch {
    return 'hidden';
  }
}

function safeDetail(input: unknown): string {
  return redactSecrets(String(input || '')).slice(0, 240);
}

export async function hermesVersion(): Promise<string> {
  try {
    const response = await fetch(`${HERMES_API_BASE}/health`, { cache: 'no-store', headers: apiHeaders(), signal: AbortSignal.timeout(2500) });
    if (!response.ok) return 'Hermes Agent API';
    const payload = await response.json().catch(() => null) as { version?: unknown; name?: unknown } | null;
    const version = typeof payload?.version === 'string' ? payload.version : '';
    const name = typeof payload?.name === 'string' ? payload.name : 'Hermes Agent API';
    return version ? `${name} ${version}` : name;
  } catch {
    return 'Hermes Agent API';
  }
}

async function getHealthUncached(): Promise<DeckHealth> {
  const [apiRes, dashRes] = await Promise.allSettled([
    fetch(`${HERMES_API_BASE}/health`, { cache: 'no-store', headers: apiHeaders(), signal: AbortSignal.timeout(2500) }),
    fetch(`${HERMES_DASHBOARD_BASE}/api/sessions`, { cache: 'no-store', signal: AbortSignal.timeout(1200) }),
  ]);
  const version = await hermesVersion();
  let apiHealthy = false;
  let apiDetail = '';
  if (apiRes.status === 'fulfilled') {
    apiHealthy = apiRes.value.ok;
    apiDetail = `HTTP ${apiRes.value.status}`;
    if (!apiRes.value.ok) {
      apiDetail = `${apiDetail} ${safeDetail(await apiRes.value.text().catch(() => ''))}`.trim();
    }
  } else {
    apiDetail = safeDetail(apiRes.reason instanceof Error ? apiRes.reason.message : String(apiRes.reason));
  }
  let dashHealthy = false;
  let dashDetail = '';
  if (dashRes.status === 'fulfilled') {
    const r = dashRes.value;
    dashHealthy = r.ok || r.status === 401 || r.status === 403;
    dashDetail = `HTTP ${r.status}`;
  } else {
    dashDetail = safeDetail(dashRes.reason instanceof Error ? dashRes.reason.message : String(dashRes.reason));
  }
  return {
    ok: apiHealthy,
    status: apiHealthy ? 'connected' : 'unreachable',
    version,
    apiServer: { baseUrl: exposeBaseUrl(HERMES_API_BASE), healthy: apiHealthy, detail: apiDetail },
    dashboard: { baseUrl: exposeBaseUrl(HERMES_DASHBOARD_BASE), healthy: dashHealthy, detail: dashDetail },
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

export const getHealth = makeCache(3_000, getHealthUncached);
