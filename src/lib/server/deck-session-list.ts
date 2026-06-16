import type { DeckSession } from '../types';
import { listProjectedSessions, type ProjectionViewer } from './deck-chat-projection.ts';
import { getSessions, PROFILE_ROUTING_UNAVAILABLE, SessionProfileRoutingError } from './hermes/sessions.ts';

export type DeckSessionListWarning = {
  code: string;
  detail: string;
  source: 'hermes-api';
};

export type DeckSessionListResult = {
  sessions: DeckSession[];
  warning?: DeckSessionListWarning;
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
    if (err instanceof SessionProfileRoutingError && err.code === PROFILE_ROUTING_UNAVAILABLE) {
      return {
        sessions: projected,
        warning: {
          code: err.code,
          detail: err.message,
          source: 'hermes-api',
        },
      };
    }
    throw err;
  }
}
