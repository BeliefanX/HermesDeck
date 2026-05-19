import type { DeckHealth } from '@/lib/types';
import { execFileAsync, makeCache, apiHeaders, HERMES_API_BASE, HERMES_DASHBOARD_BASE, startedAt } from './core';

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
    apiDetail = await apiRes.value.text().then((t) => t.slice(0, 240)).catch(() => '');
  } else {
    apiDetail = apiRes.reason instanceof Error ? apiRes.reason.message : String(apiRes.reason);
  }
  let dashHealthy = false;
  let dashDetail = '';
  if (dashRes.status === 'fulfilled') {
    const r = dashRes.value;
    dashHealthy = r.ok || r.status === 401 || r.status === 403;
    dashDetail = `HTTP ${r.status}`;
  } else {
    dashDetail = dashRes.reason instanceof Error ? dashRes.reason.message : String(dashRes.reason);
  }
  return {
    ok: apiHealthy || version.startsWith('Hermes Agent'),
    status: apiHealthy ? 'connected' : version.startsWith('Hermes Agent') ? 'degraded' : 'unreachable',
    version,
    apiServer: { baseUrl: HERMES_API_BASE, healthy: apiHealthy, detail: apiDetail },
    dashboard: { baseUrl: HERMES_DASHBOARD_BASE, healthy: dashHealthy, detail: dashDetail },
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

export const getHealth = makeCache(3_000, getHealthUncached);
