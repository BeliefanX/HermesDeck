// Hermes Agent's active delegation.child_timeout_seconds is 1800s (30m).
// Keep Deck's chat stream long enough to carry a full subagent run plus a
// small completion margin.
export const HERMES_SUBAGENT_MAX_TIMEOUT_MS = 30 * 60_000;
export const CHAT_STREAM_DEFAULT_TIMEOUT_MS = HERMES_SUBAGENT_MAX_TIMEOUT_MS + 5 * 60_000;
export const CHAT_STREAM_HARD_TIMEOUT_MS = CHAT_STREAM_DEFAULT_TIMEOUT_MS;
