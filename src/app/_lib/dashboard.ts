import type { DeckSession, ToolSummary } from '@/lib/types';

export const DASHBOARD_ACTIVITY_HOURS = 24;

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

export interface SessionAggregates {
  totalMessages: number;
  lastDayCount: number;
  sourceMap: Map<string, number>;
  profileMap: Map<string, number>;
  buckets: number[];
  peak: number;
}

export function buildSessionAggregates(
  sessions: DeckSession[],
  now: number,
  hours = DASHBOARD_ACTIVITY_HOURS,
): SessionAggregates {
  const cutoff24h = now - 24 * 3600 * 1000;
  const cutoffWindow = now - hours * 3600 * 1000;
  let totalMessages = 0;
  let lastDayCount = 0;
  const sourceMap = new Map<string, number>();
  const profileMap = new Map<string, number>();
  const buckets = Array.from({ length: hours }, () => 0);

  for (const s of sessions) {
    totalMessages += s.messageCount || 0;
    const ts = Date.parse(s.updatedAt || s.createdAt || '');
    if (Number.isFinite(ts)) {
      if (ts >= cutoff24h) lastDayCount += 1;
      if (ts >= cutoffWindow) {
        const idx = hours - 1 - Math.floor((now - ts) / (3600 * 1000));
        if (idx >= 0 && idx < hours) buckets[idx] += 1;
      }
    }
    const sk = (s.source || 'hermes').toLowerCase();
    sourceMap.set(sk, (sourceMap.get(sk) || 0) + 1);
    const pk = s.profileId || 'default';
    profileMap.set(pk, (profileMap.get(pk) || 0) + 1);
  }

  const peak = buckets.reduce((m, v) => Math.max(m, v), 0);
  return { totalMessages, lastDayCount, sourceMap, profileMap, buckets, peak };
}

export function buildToolBreakdown(tools: ToolSummary[]): Array<{ kind: string; count: number }> {
  const map = new Map<string, number>();
  tools.forEach((t) => map.set(t.kind, (map.get(t.kind) || 0) + 1));
  const order = ['toolset', 'skill', 'mcp', 'unknown'];
  return order.filter((k) => map.has(k)).map((k) => ({ kind: k, count: map.get(k)! }));
}
