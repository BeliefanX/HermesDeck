# Deck chat projection store

HermesDeck keeps a small Deck-owned JSON projection at `chat-projection.v1.json` for in-flight and recently completed Deck chat turns. It is not the source of truth for Hermes Agent history; it only bridges live Deck streams until trusted upstream session/profile metadata is available.

## Concurrency and durability

- Writers mutate the store only through `mutateStore()`.
- `mutateStore()` acquires `chat-projection.v1.json.lock` with exclusive `open(..., 'wx')`, writes an owner token, retries briefly, and removes stale lock files after five minutes.
- Lock release checks the owner token before deleting the lock file, so one process does not accidentally remove a newer writer's lock.
- Each write serializes the complete next store to a per-process temp file, `fsync`s it, then atomically renames it over the live JSON file.
- The lock covers the read → mutate → prune → write cycle so concurrent Deck server workers do not lose each other's turns.

## Cleanup bounds

The projection is bounded before every write:

- Hard cap: retain at most 750 sessions.
- TTL: completed sessions older than 14 days are eligible for removal.
- TTL: running/failed sessions older than 3 days are eligible for removal.
- Safety retention: the newest 200 running/failed sessions are retained even if stale, so active or errored turns remain diagnosable.
- Aliases are pruned when neither the alias nor its target points to a retained session.

The store also limits imported sessions/messages and strips oversized attachment data. Large binary artifacts should remain in Hermes output or browser cache, not in this projection JSON.
