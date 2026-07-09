# HermesDeck Design Handoff

HermesDeck is a Hermes Agent control deck for browser and installed PWA use: multi-session chat, Agents, configuration editing, capability panels, RBAC-admin settings, and terminal access. This handoff is a companion to the canonical design contract in [`../../design.md`](../../design.md); if details disagree, `design.md` and `src/app/globals.css` win.

> **Vibe.** Hallmark / Tally-like modern-minimal workbench. Light-first paper surfaces, hairline structure, low-shadow popovers, small indigo accent footprint, and restrained dark terminal/code areas. No marketing gradients, decorative orbs, fake browser chrome, fabricated metrics, or oversized landing-page cards.

> **Voice.** Product chrome is bilingual in the running app where the UI provides zh/en strings. Do not document or enforce an English-only UI rule. Keep copy engineer-to-engineer, concise, and literal in both languages.

---

## Canonical sources

- [`../../design.md`](../../design.md) — current Hallmark UI/design system constraints.
- [`../architecture.md`](../architecture.md) — runtime boundaries, data flow, RBAC, SSE, projection, PWA cache strategy.
- [`../configuration.md`](../configuration.md) — ports, environment variables, Deck-owned stores, Hermes API Server connection.
- [`../deployment.md`](../deployment.md) — launchd, reverse proxy, HTTPS, PWA, security boundaries.
- `src/app/globals.css` — production design tokens and component CSS. Portable mirrors in this folder are audit artifacts, not import targets.
- `src/components/AppShell.tsx` and app pages — current navigation, bilingual labels, page structure, and responsive behavior.
- `src/components/LiveTerminal.tsx` plus `src/lib/server/terminal-pty.ts` — current Live Terminal behavior.

No Figma or external brand kit is authoritative for this repository.

---

## Current system boundaries

- **Visible entrypoint:** `http://<host>:6117` is canonical for users, PWA install, and reverse proxies. Project scripts run Next on `6118` and expose `6117 -> 6118` as the same-origin reverse proxy. Hermes Agent API fallback default is `http://127.0.0.1:8642`; do not use `6117` as the Agent API default.
- **API-first runtime:** Deck production runtime data comes from Hermes Agent API Server through the Deck BFF (`/api/deck/*`). Chat uses `/v1/runs` + `/v1/runs/{run_id}/events`; tools discovery uses `/v1/skills` + `/v1/toolsets`. Do not describe local Hermes DB reads, Hermes CLI calls, or local profile/model catalog enumeration as ordinary runtime fallbacks.
- **super_admin/local-owner plane:** Local config/SOUL/USER/MEMORY editing, raw local skill file read/write, LCM SQLite dashboard, and Live Terminal are retained `super_admin` features. Do not describe them as removed, deprecated, or available to ordinary users/admins.
- **Terminology:** Deck users/accounts are login identities. Assigned Agents are runtime targets backed by Hermes Agent profiles. A Hermes Agent profile is not a Deck user profile; API fields named `profile`/`profileId` are legacy/compat Agent runtime ids.
- **Deck-owned state:** Auth/session state and chat projection live under `~/.hermesdeck` or `HERMESDECK_DATA_DIR`; projection is UX/proof state, not a Hermes runtime source of truth.
- **RBAC:** Access fails closed. Agent assignment and role checks must be proven before serving protected data or mutating state; ordinary users must not access unassigned Agents/default.
- **PWA:** Public offline shell and icons may be cached. Auth pages, API responses, chat HTML, and protected user data must not be persisted by the service worker. Web Push is currently background-capable for chat complete/failed only; Cron notifications are page-open browser notifications, not an always-on watcher.
- **Terminal:** There are two terminal-related surfaces:
  - `terminalActions` are bounded diagnostic/action endpoints implemented with `execFile`/synthetic handlers.
  - **Live Terminal** is an opt-in real shell backed by tmux/node-pty and mounted by the Terminal page when `HERMESDECK_LIVE_TERMINAL=1`. Treat it as full shell access for trusted `super_admin/local-owner` operators, not as a bounded command runner.

---

## Visual foundations

### Product stance

- Control deck, not marketing site.
- Dense workbench pages: dashboard, chat, profiles, tools, config, cron, terminal, settings, and LCM.
- Persistent app chrome: desktop side rail/top command bar; mobile app bar/bottom nav.
- Mobile/PWA behavior is first-class: safe areas, no horizontal scroll, stable chat scrollport, two-level mobile chat, and coarse-pointer hit targets.

### Color and surface model

Production tokens are OKLCH-based and live in `src/app/globals.css`.

- Light theme is the default design center: `--color-paper-*` surfaces, `--color-ink-*` text, and structured document-like panels.
- Dark theme is supported, but the design center is light paper surfaces.
- Accent is tokenized (`--color-accent`, `--accent`, `--accent-soft`, `--accent-border`) and currently indigo-hued, not a hard-coded blue hex value.
- Terminal output remains intentionally dark via `--terminal-*` tokens for legibility inside the light shell.
- Prefer semantic tokens (`--bg`, `--panel`, `--card-bg`, `--text`, `--muted`, `--green`, `--yellow`, `--red`, `--cyan`) over raw hex values.

### Typography

- Fonts are `Geist` and `Geist Mono` via `src/app/globals.css`.
- Numeric/status-heavy UI uses tabular figures where alignment matters.
- Headers stay roman; no italic headings.
- Code, IDs, command snippets, and counters use mono treatment.

### Layout and interaction rules

- Paper, not glass: neutral fills, hairline borders, minimal shadow.
- Active states use small markers or subtle paper tint, never saturated full-row fills.
- Rows and cards should read as structured documents: clear title, muted metadata, compact counters, right-aligned values where helpful.
- Empty states explain the current state and the next possible action without inventing data.
- No gradient text, decorative orbs, fake device/browser frames, testimonials, benchmark claims, or decorative autoplay motion.
- Chat scroll affordances belong in CSS-owned `.messages` behavior; avoid inline magic positioning.
- Chat message rows are wide by design: current production CSS uses `min(88%, 960px)` on desktop, with mobile/PWA rows near full width and user rows capped at 90%/92% at the 880px/480px breakpoints.

---

## Content fundamentals

- **Languages:** The running app supports zh/en UI strings. Keep new chrome strings aligned with the existing i18n pattern rather than imposing an English-only rule.
- **Tone:** Engineer-to-engineer, operational, and exact. Say what exists, what is disabled, and what is planned.
- **Terminal wording:** When Live Terminal is enabled, describe it plainly as a real shell session exposed through the browser and protected by RBAC/feature gating. Do not imply free-form shell input is impossible.
- **Architecture wording:** Use “Hermes Agent API Server”, “Deck BFF”, “Deck-owned projection”, “Assigned Agents”, “RBAC fail-closed”, “super_admin/local-owner”, “canonical 6117 entrypoint”, “Agent API 8642 default”, and “PWA protected-data cache boundary” consistently.
- **No fabricated examples:** Metrics, runtime events, costs, testimonials, and model/provider data must come from runtime/API data or be labeled as placeholder/demo content.

---

## Folder index

```text
README.md                  ← this handoff overview
SKILL.md                   ← agent skill manifest for the handoff artifact
colors_and_type.css        ← portable token mirror / audit artifact; production source is globals.css
fonts/                     ← font notes; production CSS imports Geist / Geist Mono
assets/
  brand/                   ← placeholder SVG mark/wordmark artifacts
  icons/                   ← icon-system notes
preview/                   ← design-system preview cards
ui_kits/
  webui/                   ← static WebUI kit and screen demos
    index.html             ← interactive demo shell
    *.jsx                  ← modular prototype components
    README.md
```

These assets are handoff/prototype material. They are useful for visual reference, but product behavior and security semantics must be checked against current `src/`, `design.md`, and `docs/*` before reuse.

---

## Open notes

- Brand assets in this folder are placeholders until a canonical HermesDeck brand kit is supplied.
- Portable token mirrors and static previews can drift; audit against `src/app/globals.css` before using them in implementation.
- Keep this handoff updated when terminal semantics, PWA cache boundaries, RBAC, or the canonical port topology changes.
