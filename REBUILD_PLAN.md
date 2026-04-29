# HermesDeck Clean Rebuild Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the current ClawDeck-derived prototype with a fresh Hermes-native WebUI that uses ClawDeck and open-webui only as UX references, not as the code/architecture base.

**Architecture:** Build a new feature-oriented Next.js app plus a thin Hermes BFF. HermesDeck should integrate with Hermes native API Server for chat/runs/streaming, Hermes dashboard/session APIs for admin/history/config, and Hermes profile/state isolation as first-class concepts. Avoid OpenClaw paths, stores, route names, and gateway assumptions.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind or design-token CSS, React Query/SWR, Zustand only for UI/runtime state, Express/Fastify BFF or Next route handlers, SSE for streaming.

---

## Product Principles

1. **Hermes-native first.** No `.openclaw` paths, no ACP gateway assumptions, no ClawDeck compatibility shims in new code.
2. **Open WebUI-inspired chat.** Multi-session sidebar, pinned/foldered chats, fast switching, optimistic user messages, assistant placeholder, searchable sessions.
3. **Hermes execution model visible.** Profile, agent/execution target, model, toolsets, run phase, tool events, cancellation and resume are visible in the UI.
4. **Two backend surfaces, one frontend contract.** Hermes API Server is the chat/run backend. Hermes dashboard/session/config APIs are admin sidecar APIs. HermesDeck BFF normalizes both.
5. **Feature modules over god files.** No 1000+ line route pages or mega server routers.

---

## Target Information Architecture

- `/` — command center: Hermes health, profiles, active runs, recent sessions, queued cron/jobs.
- `/chat` — primary open-webui-like multi-session chat.
- `/sessions` — searchable session DB, transcripts, exports, delete/archive.
- `/profiles` — Hermes profiles, model/provider/toolset summary, profile switch/create/import/export hooks.
- `/runs` — active/completed run timeline, tool events, cancellation/retry.
- `/tools` — toolsets, MCP servers, skills, enabled/disabled status.
- `/settings` — safe config view/edit; env secret handling must be explicit and protected.
- `/terminal` — optional local terminal surface, isolated from chat runtime.

---

## Target Source Layout

```text
src/
  app/
    (shell)/layout.tsx
    page.tsx
    chat/page.tsx
    sessions/page.tsx
    profiles/page.tsx
    runs/page.tsx
    tools/page.tsx
    settings/page.tsx
  components/
    shell/
    ui/
  features/
    chat/
      components/
      hooks/
      stores/
      types.ts
    sessions/
    profiles/
    runs/
    tools/
    settings/
  lib/
    hermes-api/
      client.ts
      types.ts
      sse.ts
    bff-api/
      client.ts
      types.ts
    config.ts
server/
  index.ts
  routers/
    health.ts
    chat.ts
    sessions.ts
    profiles.ts
    runs.ts
    tools.ts
  services/
    hermesApiServer.ts
    hermesDashboard.ts
    profileRegistry.ts
    eventReplay.ts
```

---

## Hermes Backend Contract

### Chat/runtime backend
Prefer Hermes API Server:
- `POST /v1/responses` with `stream=true` for modern streamed chat.
- `POST /v1/chat/completions` for OpenAI-compatible fallback.
- `POST /v1/runs` + `GET /v1/runs/{run_id}/events` for structured lifecycle streams.
- `GET /v1/models`, `/health`, `/health/detailed` for capabilities and readiness.

### Admin/history/config sidecar
Use Hermes dashboard APIs only for non-chat admin surfaces:
- `/api/sessions`, `/api/sessions/search`, `/api/sessions/{id}/messages`
- `/api/analytics/usage`
- `/api/config`, `/api/config/raw`, schema/defaults/model info
- `/api/skills`, `/api/tools/toolsets`

### HermesDeck BFF responsibilities
- One frontend auth/session policy.
- Route to correct Hermes profile/home.
- Normalize SSE events for UI.
- Add short replay buffer for run streams.
- Protect raw config/env/plugin APIs.
- Provide capability metadata to UI instead of hardcoding model/provider facts.

---

## Data Model

```ts
interface DeckProfile {
  id: string;
  name: string;
  active: boolean;
  hermesHome: string;
  apiServer?: { baseUrl: string; healthy: boolean };
  dashboard?: { baseUrl: string; healthy: boolean };
  model?: string;
  toolsets: string[];
}

interface DeckSession {
  id: string;
  profileId: string;
  title: string;
  source: 'api_server' | 'chat' | 'telegram' | 'cron' | 'webui';
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  folderId?: string;
}

interface DeckRunEvent {
  id: string;
  runId: string;
  sessionId?: string;
  type: 'run.started' | 'message.delta' | 'tool.started' | 'tool.progress' | 'tool.completed' | 'run.completed' | 'run.failed';
  payload: unknown;
  ts: number;
}
```

---

## Implementation Phases

### Phase 0: Freeze current prototype as reference

**Objective:** Preserve current ClawDeck-derived prototype without continuing to build on it.

**Steps:**
1. Stop current server if needed.
2. Rename/copy current `/Users/fanxuxin/HermesDeck` to `/Users/fanxuxin/HermesDeck-legacy-clawfork` or keep it as a reference branch/folder.
3. Create a fresh `/Users/fanxuxin/HermesDeck` project skeleton.
4. Keep README note explaining that the legacy fork is reference-only.

**Verification:** Fresh app starts on port `6117` and has no `.openclaw` references.

### Phase 1: Fresh app shell

**Objective:** Build the base shell without chat complexity.

**Tasks:**
1. Create Next.js + TypeScript project skeleton.
2. Add shell layout, sidebar/topbar, responsive mobile nav.
3. Add design tokens/theme/locale persistence.
4. Add typed BFF client and health endpoint.

**Verification:** `npm run typecheck`, `npm run build`, browser opens `/` and `/chat`.

### Phase 2: Hermes profile and health layer

**Objective:** Make Hermes profiles and backend health first-class.

**Tasks:**
1. Implement BFF `/api/deck/health`.
2. Implement `/api/deck/profiles` using `hermes profile list` plus config inspection, without secrets.
3. Add health cards and profile switcher.
4. Add clear error states for missing API server/dashboard.

**Verification:** UI shows real Hermes profiles and health from LAN address.

### Phase 3: Chat MVP using Hermes API Server

**Objective:** Replace CLI wrapper with Hermes native streaming.

**Tasks:**
1. Implement BFF client for `/v1/responses` streaming.
2. Build chat session sidebar and active thread UI.
3. Implement composer, optimistic user message, assistant placeholder, stream deltas.
4. Add cancel on disconnect/button.
5. Persist local UI metadata separately from Hermes canonical session state.

**Verification:** Send prompt from browser, receive streamed deltas, cancel works, console has no errors.

### Phase 4: Session DB integration

**Objective:** Use Hermes state/session APIs for history and search.

**Tasks:**
1. Implement `/api/deck/sessions` proxy/normalizer.
2. Implement session search and transcript loading.
3. Implement pin/folder/archive as Deck-local metadata keyed by Hermes session id.
4. Add export/import where safe.

**Verification:** Existing Hermes sessions appear; opening a session loads messages.

### Phase 5: Runs/tool timeline

**Objective:** Show Hermes-specific execution lifecycle.

**Tasks:**
1. Add `/runs` page.
2. Render SSE event timeline: run started, message deltas, tool start/progress/complete, completed/failed.
3. Add right-side run panel in chat.
4. Add replay buffer in BFF for reconnect.

**Verification:** Tool-using prompt shows tool events and final answer.

### Phase 6: Admin surfaces

**Objective:** Add Hermes-specific management pages after chat is solid.

**Tasks:**
1. Profiles page.
2. Tools/skills/MCP page.
3. Settings/config page with protected secret handling.
4. Usage/analytics page.
5. Jobs/cron page.

**Verification:** Pages read from Hermes APIs; no ClawDeck legacy data sources.

---

## Non-goals for the clean rebuild

- Do not keep ClawDeck route/API compatibility.
- Do not expose raw env/config APIs without explicit protection.
- Do not implement OpenClaw gateway/ACP assumptions.
- Do not hardcode provider/model capability metadata in frontend.
- Do not make official Hermes dashboard the primary chat API.

---

## Acceptance Criteria for v1

1. No `.openclaw` or `OpenClaw` references in runtime code.
2. Chat uses Hermes API Server streaming, not `hermes chat` CLI wrapper except as a documented fallback.
3. Multiple Hermes sessions can be created, switched, searched, and resumed.
4. Profile/agent switcher maps to real Hermes profiles/execution contexts.
5. Tool/run events are represented in UI.
6. LAN access works at `http://10.10.10.253:6117/`.
7. `npm run typecheck` and `npm run build` pass.
