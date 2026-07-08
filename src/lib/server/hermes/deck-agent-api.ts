import { NextResponse } from 'next/server';
import { apiHeaders, getHermesApiBase, redactSecrets } from './core';

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function list(value: unknown, keys: string[] = ['data', 'items']): unknown[] {
  if (Array.isArray(value)) return value;
  const row = record(value);
  for (const key of keys) if (Array.isArray(row[key])) return row[key] as unknown[];
  return [];
}

export async function upstreamJson(profileId: string, method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<NextResponse> {
  const apiBase = getHermesApiBase(profileId);
  if (!apiBase) {
    return NextResponse.json({ ok: false, error: 'profile_routing_unavailable', detail: `Selected Agent '${profileId}' has no configured API server base.` }, { status: 502 });
  }
  const res = await fetch(`${apiBase.replace(/\/+$/, '')}${path}`, {
    method,
    cache: 'no-store',
    headers: apiHeaders(profileId),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text().catch(() => '');
  let payload: unknown = raw ? raw : { ok: true };
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = { error: redactSecrets(raw).slice(0, 240) }; }
  }
  return NextResponse.json(payload, { status: res.status });
}

export function safeSummary(payload: unknown): Record<string, unknown> {
  const row = record(payload);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !/(key|token|secret|password|credential)/i.test(key)));
}
