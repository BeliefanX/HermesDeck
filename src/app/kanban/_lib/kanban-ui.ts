import type { KanbanTaskStatus } from '@/lib/types';
import type { Tone } from '@/components/Brand';

// Mirror Hermes's task workflow (hermes_cli/kanban_db.py VALID_STATUSES):
// triage → todo → ready → running → blocked → done → archived. We render
// everything except archived (those are hidden by default; surfaced via
// the archive action button on each row).
export type ColumnKey = 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'done';
export const COLUMNS: ColumnKey[] = ['triage', 'todo', 'ready', 'running', 'blocked', 'done'];

export const DEFAULT_BOARD_LS_KEY = 'kanban:defaultBoard';
export const SHOW_EMPTY_LS_KEY = 'kanban:showEmpty';
export const DETAIL_WIDTH_LS_KEY = 'kanban:detailWidth';

// Detail-panel width clamps. Min keeps the toolbar buttons + tag chips from
// wrapping ugly; max stops the user from squeezing the kanban columns into
// uselessness. Default sits in the middle of the old clamp(360,32vw,520).
export const DETAIL_WIDTH_MIN = 320;
export const DETAIL_WIDTH_MAX = 900;
export const DETAIL_WIDTH_DEFAULT = 460;

export const POLL_MS = 4000;
export const SECONDARY_POLL_MS = 12000; // diagnostics / stats / assignees
export const SSE_DEBOUNCE_MS = 350; // batch event-tick refreshes

export function readLocalString(key: string): string {
  if (typeof window === 'undefined') return '';
  try { return window.localStorage.getItem(key) || ''; } catch { return ''; }
}

export function writeLocalString(key: string, val: string) {
  if (typeof window === 'undefined') return;
  try {
    if (val) window.localStorage.setItem(key, val);
    else window.localStorage.removeItem(key);
  } catch {/* quota / disabled — silently noop */}
}

export function clampDetailWidth(n: number): number {
  if (!Number.isFinite(n)) return DETAIL_WIDTH_DEFAULT;
  return Math.min(DETAIL_WIDTH_MAX, Math.max(DETAIL_WIDTH_MIN, Math.round(n)));
}

export function readDetailWidth(): number {
  const raw = readLocalString(DETAIL_WIDTH_LS_KEY);
  if (!raw) return DETAIL_WIDTH_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? clampDetailWidth(n) : DETAIL_WIDTH_DEFAULT;
}

export function statusTone(status: KanbanTaskStatus): Tone {
  if (status === 'running') return 'accent';
  if (status === 'done') return 'green';
  if (status === 'blocked') return 'red';
  if (status === 'archived') return 'default';
  if (status === 'triage') return 'yellow';
  if (status === 'todo') return 'default';
  return 'cyan';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
