import type { DeckSession } from '../types';
import { listProjectedSessions, type ProjectionViewer } from './deck-chat-projection.ts';
import { getSessions, SessionProfileRoutingError } from './hermes/sessions.ts';

export type DeckSessionListResult = {
  sessions: DeckSession[];
};

export function mergeSessions(preferred: DeckSession[], fallback: DeckSession[]): DeckSession[] {
  const seen = new Set<string>();
  return [...preferred, ...fallback]
    .filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export async function listDeckSessionsForProfile(profile: string, viewer: ProjectionViewer): Promise<DeckSessionListResult> {
  const projected = listProjectedSessions(profile, viewer);
  try {
    const api = await getSessions(profile);
    return { sessions: mergeSessions(projected, api) };
  } catch (err) {
    if (err instanceof SessionProfileRoutingError && projected.length > 0) {
      // Do not trust unlabeled upstream rows for a named Agent, but do not turn
      // that Agent-runtime metadata proof gap into "the Deck user has no
      // assignment". Return only Deck-owned, owner/RBAC-scoped projected
      // sessions; callers still fail closed when there is no Deck proof.
      return { sessions: projected };
    }
    throw err;
  }
}
