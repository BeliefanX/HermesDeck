import type { DeckHealth } from '@/lib/types';
import { execFileAsync, makeCache, apiHeaders, HERMES_API_BASE, HERMES_DASHBOARD_BASE, startedAt, redactSecrets } from './core';

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
    const { stdout } = await execFileAsync('hermes', ['--version'], { timeout: 8000 });
    return stdout.trim() || 'Hermes';
  } catch (err) {
    return `Hermes (${err instanceof Error ? err.message : 'version unavailable'})`;
  }
}

async function getHealthUncached(): Promise<DeckHealth> {
  // Run version + the two health probes in parallel — the version call shells
  // out to `hermes --version` (slow) and previously blocked the HTTP probes.
  const [versionRes, apiRes, dashRes] = await Promise.allSettled([
    hermesVersion(),
    fetch(`${HERMES_API_BASE}/health`, { cache: 'no-store', headers: apiHeaders(), signal: AbortSignal.timeout(2500) }),
    fetch(`${HERMES_DASHBOARD_BASE}/api/sessions`, { cache: 'no-store', signal: AbortSignal.timeout(1200) }),
  ]);
  const version = versionRes.status === 'fulfilled'
    ? versionRes.value
    : `Hermes (${versionRes.reason instanceof Error ? versionRes.reason.message : 'version unavailable'})`;
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
    ok: apiHealthy || version.startsWith('Hermes Agent'),
    status: apiHealthy ? 'connected' : version.startsWith('Hermes Agent') ? 'degraded' : 'unreachable',
    version,
    apiServer: { baseUrl: exposeBaseUrl(HERMES_API_BASE), healthy: apiHealthy, detail: apiDetail },
    dashboard: { baseUrl: exposeBaseUrl(HERMES_DASHBOARD_BASE), healthy: dashHealthy, detail: dashDetail },
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

export const getHealth = makeCache(3_000, getHealthUncached);
