# Glossary

## HermesDeck

Deck/BFF/UI layer for Hermes Agent. It owns browser UX, Deck auth/RBAC, Agent-scoped authorization, SSE forwarding, projection proof and PWA behavior. It does not own Hermes runtime persistence. Its chat stream timeout cap is 35 minutes (2,100,000ms), aligned to Hermes active subagent timeout plus margin.

## Deck user / account

A login identity managed by HermesDeck (`auth.json`): username, password hash, optional TOTP/passkey MFA metadata, role, status and assigned Agent ids. A Deck user/account is not a Hermes Agent profile.

## Agent

The user-facing runtime target in HermesDeck. An Agent is backed by a Hermes Agent execution/config scope (technically a Hermes Agent profile id), but Deck users see and are assigned Agents, not user profiles. API fields named `profile` / `profileId` are legacy/compat identifiers for this Agent runtime id.

## Hermes Agent profile

The Hermes runtime isolation/config unit behind an Agent (`default` or `~/.hermes/profiles/<id>`). It is not a Deck user profile and does not manage Deck users or permissions.

## Hermes Agent API Server

The runtime source of truth for Deck. Agents/catalog, models, chat `/v1/runs` events, cron proof and other runtime data must come through API endpoints. If the API cannot provide required runtime proof for sensitive upstream data, Deck fails closed. Default fallback API base is `http://127.0.0.1:8642`; Deck's `6117` UI port is not the Agent API port.

## BFF

Backend-for-Frontend implemented with Next Route Handlers under `/api/deck/*`. It converts browser requests into Hermes API Server calls and enforces Deck auth/RBAC/CSRF/Agent scope.

## Agent assignment

Deck auth-store mapping from a Deck user/account to allowed Agent runtime ids. Missing Agent assignment for ordinary users means 403. Deck never treats a local Hermes profile directory as authorization proof.

## Model catalog

The selectable model list returned by Hermes API Server `/v1/models` for an Agent. Deck does not synthesize it from local files.

## Session

A chat conversation identifier. For named Agents, Deck requires projection proof before continuing an existing session/response chain.

## Trusted Deck-generated session id

A server-generated `deck_<uuid>` used when a named-Agent request supplies an unproven session id. Deck can safely pass it as `X-Hermes-Session-Id` because it was generated in the authenticated/Agent-scoped request.

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

## Async delegation result

A Hermes async `delegate_task` completion marker in history: `[ASYNC DELEGATION COMPLETE — deleg_<8hex>]` or `[ASYNC DELEGATION BATCH COMPLETE — deleg_<8hex>]`. Deck normalizes it into an assistant-side `delegate_task` subagent result for display, while the immediate background dispatch acknowledgement remains a separate `Subagent dispatched` card.

## Cron proof

Evidence that Hermes API Server cron data belongs to the requested Agent: response-level `profile`/routing fields, every job row carrying the requested Agent runtime id, or Deck server-owned dedicated named-Agent API routing for legacy profileless rows. Shared/default routing is not proof. Without proof, Deck returns `profile_routing_unavailable`; explicit mismatch returns 403.

## RBAC fail-closed

Security posture where missing auth, missing Agent assignment, invalid Agent access or unproven routing blocks access instead of guessing, locally enumerating, or falling back to a broader/default Agent. Catalog outage alone is an upstream availability issue, not proof that a user lacks permission.

## Canonical visible entrypoint

`6117`. The launcher runs Next on `6118` internally and a transparent reverse proxy on `6117`. User docs, PWA URL, launchd checks and production reverse proxies should point at `6117` unless a custom deployment deliberately changes the public port.

## Internal target

`6118`, the Next.js service port created by current npm scripts. It is not the primary user-facing URL in current docs.

## Terminal Action

Whitelisted, bounded command runner exposed through `/api/deck/terminal/run`; intended for safe diagnostics/actions and secret-redacted output.

## Live Terminal

Optional tmux + node-pty shell, enabled only with `HERMESDECK_LIVE_TERMINAL=1`. It gives active `super_admin` a real shell on the host and remains part of the `super_admin/local-owner` management plane.

## PWA shell cache

Service Worker cache for public offline-safe shell assets only: `/offline`, manifest and icons.

## Web Push notification

Browser Push API delivery through HermesDeck's Service Worker. Current background support is limited to chat complete/failed notifications and requires HTTPS/localhost, VAPID env, a logged-in Deck user subscription, and browser permission. Payloads are intentionally low-sensitivity and click through only to same-origin non-API app URLs.

## Page-open notification

Browser `Notification` created by an active page. Current Cron job completion notifications are page-open only: they work while the relevant page is loaded and has permission, but they do not run from a closed tab/PWA background watcher.

## Runtime cache

Service Worker cache for static style/script/image/font assets, LRU capped. It must not store protected navigation HTML or API responses.
