# Glossary

## HermesDeck

Deck/BFF/UI layer for Hermes Agent. It owns browser UX, Deck auth/RBAC, profile scoping, SSE forwarding, projection proof and PWA behavior. It does not own Hermes runtime persistence. Its chat stream timeout cap is 35 minutes (2,100,000ms), aligned to Hermes active subagent timeout plus margin.

## Hermes Agent API Server

The runtime source of truth for Deck. Profiles, models, chat responses, cron proof and other runtime data must come through API endpoints. If the API cannot prove data, Deck fails closed.

## BFF

Backend-for-Frontend implemented with Next Route Handlers under `/api/deck/*`. It converts browser requests into Hermes API Server calls and enforces Deck auth/RBAC/CSRF/profile scope.

## Profile

A Hermes Agent execution/config scope. Deck lists profiles from API-backed catalog only. Ordinary users need explicit profile assignment; admin/super_admin can see all API-backed profiles.

## Profile assignment

Deck auth-store mapping from user to allowed profile ids. Missing assignment for ordinary users means 403. Deck never treats a local directory as authorization proof.

## Model catalog

The selectable model list returned by Hermes API Server `/v1/models` for a profile. Deck does not synthesize it from local files.

## Session

A chat conversation identifier. For named profiles, Deck requires projection proof before continuing an existing session/response chain.

## Trusted Deck-generated session id

A server-generated `deck_<uuid>` used when a named-profile request supplies an unproven session id. Deck can safely pass it as `X-Hermes-Session-Id` because it was generated in the authenticated/profile-scoped request.

## `X-Hermes-Session-Id`

Header sent to Hermes API Server only for trusted continuation/session alignment. Hermes may also return this header as canonical session id; Deck reconciles projection aliases when it appears.

## Stream Hub

In-process SSE replay bus. It buffers events with sequence numbers, supports resume by `since`, sends keep-alive comments, and keeps upstream pumping after a browser refresh/detach.

## Run event

Raw upstream event from Hermes API Server. Tool calls, function argument deltas, skill/subagent events and attachments are forwarded as run events; only text deltas become assistant bubble text. Projectable tool/function call/result semantic boundaries are materialized into Deck projection rows, but argument deltas themselves are not durably written per delta.

## Deck chat projection

Deck-owned file-backed UX/proof state. It records observed sessions/messages/status/response aliases with locking, atomic writes and prune limits. It can persist draft assistant, tool-call and tool-result rows so refresh/polling can recover in-flight UI. It is not Hermes runtime persistence.


## Tool-call row

A projected assistant message representing a tool/function invocation. Deck links both Responses item ids (for example `fc_*`) and stable call ids (for example `call_*`) so completed arguments and later outputs attach to the same visible call.

## Tool-result row

A projected tool message representing tool output. If upstream sends an array of content parts, Deck normalizes text parts into a single text payload before storing the row.

## Cron proof

Evidence in Hermes API Server cron response that requested profile routing was honored: response-level profile/routing fields or every job row carrying the requested profile. Without proof, Deck returns `profile_routing_unavailable`.

## RBAC fail-closed

Security posture where missing auth, missing profile assignment, catalog outage or unproven routing blocks access instead of guessing, locally enumerating, or falling back to a broader profile.

## Canonical visible entrypoint

`6117`. The launcher runs Next on `6118` internally and a transparent reverse proxy on `6117`. User docs, PWA URL, launchd checks and production reverse proxies should point at `6117` unless a custom deployment deliberately changes the public port.

## Internal target

`6118`, the Next.js service port created by current npm scripts. It is not the primary user-facing URL in current docs.

## Terminal Action

Whitelisted, bounded command runner exposed through `/api/deck/terminal/run`; intended for safe diagnostics/actions and secret-redacted output.

## Live Terminal

Optional tmux + node-pty shell, enabled only with `HERMESDECK_LIVE_TERMINAL=1`. It gives active admin/super_admin a real shell on the host.

## PWA shell cache

Service Worker cache for public offline-safe shell assets only: `/offline`, manifest and icons.

## Runtime cache

Service Worker cache for static style/script/image/font assets, LRU capped. It must not store protected navigation HTML or API responses.
