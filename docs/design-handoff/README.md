# HermesDeck Design System

Hermes-native WebUI for power users — multi-session AI chat with profile/run awareness, model & tool management, integrated terminal, and PWA mobile support. This design system captures the aesthetic, tokens, and component vocabulary used across the app so future work stays cohesive.

> **Vibe.** Linear · Raycast · Vercel dashboard · classic terminal multiplexers. Dense, data-rich, monochrome with a single sky-blue accent. Dark mode is first-class. Mobile is first-class. No SaaS gradients, no oversized marketing cards, no hero patterns.

> **Voice.** UI chrome is **English-first throughout**. Other languages (incl. zh-CN) appear only as user-generated chat content rendered by `MessageContent.tsx` — never in nav, kickers, headers, body, buttons, status pills, or empty states.

---

## Sources

- **Codebase** — `src/` (Next.js App Router · TypeScript) — read-only via the local mount.
  - `src/app/globals.css` — the canonical token + component CSS (~2440 lines). All visual decisions in this design system are extracted from here.
  - `src/app/layout.tsx` — root layout, metadata, theme bootstrap script.
  - `src/components/AppShell.tsx` — sidebar / topbar / mobile-nav scaffolding, bilingual nav labels, lucide icons.
  - `src/app/page.tsx` — Command Deck dashboard (the densest visual reference: metrics, sparklines, KV lists, bar lists, KPI strips).
  - `src/app/chat/page.tsx` — multi-session chat with sessions / thread / timeline panels, slash commands, attachments.
  - `src/app/terminal/page.tsx` — the safe-ops console.
- **No Figma file provided.** All visuals come from the codebase.
- **Brand assets.** No external brand kit was provided. The mark in this system is a recreation of the in-app `brand-badge` (sky-blue glyph on near-black square) since the actual `/icons/icon-192.png` referenced by `layout.tsx` is not in the mounted `src/` tree.

---

## Index

```
README.md                  ← you are here
SKILL.md                   ← Agent Skill manifest (cross-compatible w/ Claude Code)
colors_and_type.css        ← CSS variables (color, type, radii, motion)
fonts/                     ← Inter + JetBrains Mono notes (CDN-loaded; see file)
assets/
  brand/                   ← Recreated brand mark (SVG)
  icons/                   ← Lucide is the icon system — loaded via CDN
preview/                   ← Design-system cards (registered as assets)
ui_kits/
  webui/                   ← HermesDeck WebUI kit
    index.html             ← Interactive demo (sidebar + dashboard + chat)
    *.jsx                  ← Modular components (AppShell, Cards, Composer, …)
    README.md
```

---

## Content fundamentals

**Language.** UI chrome is **English-first throughout** — nav, kickers, H1/H2, body, button labels, status pills, empty states. Simplified Chinese (and any other language) appears **only as user-generated chat content** rendered through `MessageContent.tsx`; never in product chrome. The codebase as it stands ships a zh-CN nav for power users — multi-session AI chat with profile/run awareness, model & tool management, integrated terminal, and PWA mobile support, but the canonical voice and the spec encoded in this design system is English. When recreating any screen, translate chrome strings to English (Profiles, Models, Runs, Tools, Terminal, Settings).

**Tone.** Engineer-to-engineer. Direct, precise, never marketing-y. Nothing exclamatory. The product trusts the reader to know terms like *profile*, *gateway*, *SSE*, *toolset*, *MCP*, *replay buffer*. When something is a placeholder, it says so plainly — `Planned`, `No data yet`, `model from Hermes config`.

**Casing & punctuation.**
- Section kickers: `UPPERCASE WITH 0.14em LETTER-SPACING` (e.g. `COMMAND DECK`, `EXECUTION CONTEXTS`, `RUN TIMELINE`, `SAFE OPS CONSOLE`).
- H1 / H2: sentence case. `Hermes control deck`, `Recent sessions`, `Top models · 14d`.
- Code / config tokens stay literal: `~/.hermes/state.db`, `shell:false`, `response.delta`, `run-event`, `hermes auth list`.
- Em-dash `—` (U+2014) for empty values; en-dash `–` (U+2013) for ranges (`14d`, `5–10ms`); middle-dot `·` as a soft separator (`24h · 142`, `tool · skill · MCP`). **No CJK punctuation in chrome** (no `、。，：` etc.) — those appear only inside chat message bodies.

**No emoji.** Anywhere. Iconography is the lucide-react set, used at `size={11–18}` aligned to text.

**"You" vs "I".** Neither, mostly. Copy is descriptive of the system, not addressed to a user. *"Multi-session chat workbench"*, *"All data sourced from Hermes-native state.db"*. Imperatives are reserved for action buttons (`Run`, `Open chat`, `Copy`, `Clear output`).

**Numbers.** Always `font-variant-numeric: tabular-nums` so columns align. Token counts use `K / M / B` shorthand (`fmtTokens`); costs use `$` with decimals scaled to magnitude (`$0.45`, `$2.34`, `$120`); times use compact relative form (`just now`, `12m ago`, `3h ago`, `2d ago`, then `M/D`).

**Examples worth lifting verbatim (English re-cast of the codebase strings).**
- Hero subtitle: *"Multi-session chat workbench. Profiles, Runs, Tools and the safe terminal in one console. All data sourced from Hermes-native state.db and API Server — zero hard-coding in the frontend."*
- Terminal page hook: *"Not a raw web shell — a governed terminal."* Then: *"HermesDeck's safe terminal only runs server-side allowlisted actions, executes with `shell:false`, and applies timeout, truncation and secret-redaction automatically."*
- Empty state on Runs: *"A standalone run index ships alongside the BFF replay buffer."*
- Empty state on Terminal output: *"Free-form commands are intentionally not accepted — this is not a remote shell."*

The voice is *engineering-honest*: it says what's there, what's planned, and what's deliberately constrained.

---

## Visual foundations

### Surfaces & elevation

Surfaces are **layered solids**, not glass blur. Five levels stack from the page background up:

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#08090c` | `#fafafa` | Page background, sidebar, topbar |
| `--bg-soft` | `#0b0c11` | `#f4f4f5` | Input backgrounds, code-block bodies |
| `--panel` | `#13141a` | `#ffffff` | Cards (`--card-bg`) |
| `--panel-2` | `#1c1e26` | `#f7f7f9` | Inputs, secondary buttons, hovered cards |
| `--panel-3` | `#272a35` | `#ececef` | Active hover states, code-bar header |

Hairlines are explicit: `--line: rgba(255,255,255,.06)`, with a stronger `--line-strong` at `.11` for hover/focus. Light mode flips to `rgba(15,23,42,…)`.

### Color philosophy

Almost everything is monochrome. The only chromatic accent is **sky blue** — `#38bdf8` (dark) / `#0ea5e9` (light) — used as: button primary fill, active-nav pill background, bar-fill on data viz, link color, focus ring. It appears at most a few times per screen.

Status colors are restrained, used only for state semantics (never decoration):
- `--green: #22c55e` — `ok`, healthy, active, allowlisted, completed run
- `--yellow: #eab308` — `warn`, degraded, planned
- `--red: #ef4444` — `bad`, failed, danger button border
- `--cyan: #67e8f9` — only on the `tag.cyan` source pills (Slack/iMessage/etc.)

Tags / source pills are intentionally **soft-tinted** (`rgba(…, .12)` background + matching text color) so a session list feels visually quiet even when many sources mix.

### Typography

Two families, both via CDN.

- **Inter** — primary UI (4 weights actually used: 400, 500, 550 [via variable axis], 600/620/650/680, 700). Loaded with `font-feature-settings: "cv01","cv03","ss03"` and aggressive negative letter-spacing on display sizes (`-0.035em` on H1).
- **JetBrains Mono** — code blocks, `.kbd`, kbd-like data values, timestamps, IDs, log output. `font-variant-numeric: tabular-nums` on every numeric label.

Body text is **14px / 1.55**. Big numbers (metric values) use `clamp(28px, 3.2vw, 34px)` with `font-weight: 680` and `letter-spacing: -0.05em`. The signature density move: section kickers at `9.5–10.5px` with `0.14em` letter-spacing, lowercase `--muted-2` color — they whisper context without shouting.

See `colors_and_type.css` for the exact variable list and semantic mappings.

### Spacing, radii, density

- Radii are flat: `--r-1: 6px`, `--r-2: 8px`, `--r-3: 10px`, `--r-4: 14px`, `--r-pill: 999px`. Cards use `--r-3`; hero card uses `--r-4`; pills use `--r-pill`. No 16/20/24 radii — the surface is more rectangular than rounded.
- Card padding: `18px` desktop, `14–16px` mobile (uniform across all card variants on phones — that's an explicit rule in the codebase).
- Page padding: `clamp(16px, 1.8vw, 28px)`.
- Grid gaps: `14–16px` between cards, `8–10px` for inner item lists.
- Touch targets: `min-height: 36px` for default `.btn`, `40px` minimum for icon-only on mobile, `44–52px` for the bottom nav. iOS-zoom-prevention is hard-set: inputs are `font-size: 16px`.

### Backgrounds

**No imagery, no patterns, no gradients-as-decoration.** The only gradient anywhere is `--grad-brand` (`linear-gradient(140deg, #7dd3fc 0%, #0ea5e9 100%)`), reserved for the brand mark. The hero card has *one* ambient accent glow (`radial-gradient` of `--accent-soft`, top-right) — the single permitted "design moment." Everything else is solid surface + 1px line.

### Shadows

Aggressively flat. `--shadow-card: none`. Only **floating popovers** carry elevation:

- `--shadow-pop: 0 16px 40px rgba(0,0,0,.42), 0 1px 0 rgba(255,255,255,.06) inset` — popovers, sheets, the PWA-update toast.
- `--shadow-accent: none` — primary buttons rely on color, not lift.
- `--ring: 0 0 0 2px rgba(56,189,248,.55)` — focus state, the only "glow" you'll see in normal use.

Inset highlights (`box-shadow: 0 1px 0 var(--highlight-top) inset`) are sprinkled on chips, kbd tags, and code-block bars — a single-pixel top sheen for tactility. That's it.

### Borders

1px hairlines everywhere. Borders carry the elevation; shadows do not. Adjacent panels (sessions / thread / timeline) are separated by a single `border-left: 1px solid var(--line)` rather than gaps.

### Hover & press states

- **Hover** on cards: `border-color: var(--line) → var(--line-strong)`, `background: --card-bg → --card-bg-strong`. No lift, no scale.
- **Hover** on nav links: `background: var(--glass)` (= 4% white in dark), text → `--strong-text`.
- **Hover** on action cards: border tints to `--accent-border` and the card translates `-1px`. (One of the few translate-on-hover moments.)
- **Press**: buttons translate `+0.5px` and apply `filter: brightness(.96)` (`.92` for primary). No scale.
- All transitions: `var(--t-2) var(--ease)` = `200ms cubic-bezier(.2,.7,.2,1)`. Nav active-pill swaps use `var(--t-3) var(--ease-out)` = `300ms cubic-bezier(.16,1,.3,1)`.

### Animation

Sparse and functional. `pulse` (2.4s ease-in-out infinite) on the live status dot. `fadeUp` (.25s) when a new chat message lands. `shimmer` on skeletons. `typing` on the three-dot loader. **No bounces, no springs, no parallax, no auto-playing decorative motion.** All animations are gated by `@media (prefers-reduced-motion: reduce)`.

### Transparency & blur

Used sparingly, never as decoration. `--glass: rgba(255,255,255,.04)` is the universal hover tint. There is **no `backdrop-filter: blur`** anywhere — the design uses opaque layered solids instead.

### Imagery

The product has none. No marketing photography, no illustrations, no avatars in chat. The mood is the absence of imagery — a console, not a magazine.

### Cards

The canonical card:

```css
.card {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 18px;
  background: var(--panel);          /* solid */
  box-shadow: none;                  /* flat */
}
```

Variants: `.hero-card` adds the radial glow + `--r-4`; `.metric-card` enforces a 130px min-height with the big tabular number; `.action-card` is a smaller surface variant on `--surface-bg`.

### Layout rules

- Desktop sidebar: `248px` wide, sticky, collapsible to `60px`. Mobile: hidden, replaced by a 5-cell bottom nav with safe-area padding.
- Topbar: `56px`, sticky, holds breadcrumb + theme toggle.
- The active nav row uses an **accent left bar** (`2px` wide, `rgba(56,189,248,.34)` border, accent-soft background) — not a fill, not a chip. It's the design's signature interaction detail.
- "Edge toggles" on chat: 26px circular buttons that straddle a panel border, half on each side. Premium-detail moment.
- Mobile bottom nav active state uses a **top accent indicator** — a 2×18px bar at the top edge of the active cell with an accent glow.

### Data viz

All charts are CSS — no chart library:
- **Sparklines** are `display: flex` of `.spark-bar` divs with computed `height: %`. Bars with data are `--accent` at 65% opacity; the peak bar is full opacity.
- **Bar lists** use a 3-column grid: `[label][track][value]`, with the track being a 6px-tall `--surface-bg` rail and an accent fill animated to width on update.
- **Heatmap** (weekday / hour rhythm) modulates `opacity` of an accent fill from `0.12 + intensity * 0.88`.
- **Stacked daily chart** uses two segments per bar (`is-input` / `is-output`) — input is solid accent, output is muted accent.

---

## Iconography

**Lucide React** is the icon system, used everywhere via `import { Foo } from 'lucide-react'`. Stroke-based, 2px stroke width, rounded line caps. Sizes: `11` (in pills), `12–13` (inline with text), `15–16` (in buttons), `18–22` (in metric icons / hero / empty states). Color always inherits or is set inline to a token (`var(--accent)`, `var(--muted)`, `var(--green)`, etc.).

Specific glyphs in active rotation (from AppShell, dashboard, chat, terminal):

```
Home, MessageSquare, Bot, Cpu, Radio, Wrench, Terminal, Settings,
PanelLeftClose, PanelLeftOpen, Sun, Moon, Menu, X,
HeartPulse, Database, Hash, BarChart3, Activity, Server, Sparkles,
Plug, Boxes, Layers, Clock, GitBranch,
Coins, ArrowDownRight, ArrowUpRight, TrendingUp, DollarSign, Zap,
CalendarDays, Flame, ChevronRight, ChevronDown, ChevronLeft,
Search, Pin, PinOff, Pencil, FolderInput, FolderMinus, FolderPlus,
Tag, Archive, ArchiveRestore, Trash2, Inbox, ListFilter,
Plus, Square, Send, AlertTriangle, AlertCircle, CheckCircle2,
ArrowDown, Paperclip, Upload, Network, MoreHorizontal,
Copy, Check, Play, ShieldCheck
```

This kit ships **lucide via CDN** in the UI-kit HTML (`https://unpkg.com/lucide-static/font/lucide.css` is unsuitable; use the SVG sprite or inline SVGs). For prototyping in single-file HTML we link `https://unpkg.com/lucide@0.474.0/dist/umd/lucide.min.js` and call `lucide.createIcons()`.

**No emoji.** **No unicode glyphs as icons** (no ✓, ✗, →, etc.). The em-dash `—` is the one allowed unicode character, used as an empty-value placeholder.

**Brand mark.** Until real brand artwork lands, the placeholder mark is a **Lucide-style stroke-2 lineart `HD` monogram** in `assets/brand/hermesdeck-mark.svg` — same stroke weight, line caps and joins as every other icon in the system, so it sits naturally next to nav glyphs. It uses `currentColor`, so it inherits accent or strong-text. A wordmark variant (`hermesdeck-wordmark.svg`) pairs the same monogram with the "HermesDeck" wordmark for sidebar/topbar use. Both will be replaced once the real `/icons/icon-192.png` (and any vector wordmark) are provided.

---

## Caveats / open questions for the user

- **Brand mark is a reconstruction.** I could not access `public/icons/icon-192.png` (referenced in `src/app/layout.tsx`). The `assets/brand/hermesdeck-mark.svg` shipped here was rebuilt from the `brand-badge` CSS in `globals.css`. Replace it with the real PNG/SVG when convenient.
- **Fonts are CDN-only.** Inter and JetBrains Mono come from `fonts.googleapis.com`. No local TTFs were provided; the `fonts/` folder documents the loader URL but has no binaries.
- **No Figma.** All decisions are extracted from `globals.css` and the page components.
