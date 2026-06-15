# HermesDeck Hallmark Design System

Date: 2026-06-04
Scope: web app + installed PWA shell

## Hallmark selection

- Genre: modern-minimal.
- Theme marker: studied-DNA (source: Tally). Tally is used as a public visual reference only; HermesDeck does not copy its content, metrics, pricing, customer names, or pixel layout.
- Surface direction: light-first paper UI with restrained dark mode for terminal, night work, and code-heavy content.
- Macrostructure:
  - Workbench for cockpit pages such as dashboard, chat, terminal, runs, settings, tools, profiles, config, kanban, and LCM.
  - Index-First for route hubs, filters, session lists, run lists, and tool registries.
  - Long Document for auth/offline/pending states and static support content.
- Navigation: persistent desktop side rail, top command/search bar, and mobile bottom navigation. This remains app chrome, not a marketing navbar.
- Footer: no marketing footer in the app shell.
- PWA/mobile priorities: safe areas, no horizontal scroll, stable chat scrollport, two-level mobile chat, and coarse-pointer hit targets at least 44px.

## Tally DNA

- Paper, not glass: neutral paper backgrounds, hairline borders, low-shadow popovers, and compact invoice/workbench rows.
- Accent footprint is tiny: indigo marks active rows, focus, links, command hints, and selected controls. Large cyan fills are removed.
- Controls are pills or compact rectangles: search, tabs, chips, buttons, source filters, and toggles should feel like document controls.
- Information hierarchy is tabular: specs, row titles, muted secondary metadata, mono counters, and right-aligned values.
- Empty data is explicit: empty states should explain the current state rather than rendering dashes that look broken.

## System tokens

Production tokens live in `src/app/globals.css`. `tokens.css` is a portable mirror for audit/export and should not be imported unless the build pipeline is intentionally updated.

Core values:

- Font aliases: `--font-sans` = Geist, `--font-mono` = Geist Mono.
- Paper: `--color-paper-0: oklch(98.4% 0.005 258)`.
- Ink: `--color-ink-0: oklch(18% 0.030 258)`.
- Accent: `--color-accent: oklch(54% 0.220 268)`.
- Companion green: `--color-companion: oklch(82% 0.180 130)`.

Legacy aliases are preserved and mapped to the new system:

- Surfaces: `--bg`, `--bg-soft`, `--panel`, `--panel-2`, `--panel-3`, `--card-bg`, `--surface-bg`, `--input-bg`.
- Text: `--text`, `--strong-text`, `--value-text`, `--muted`, `--muted-2`, `--nav-text`.
- Accent/status: `--accent`, `--accent-2`, `--accent-soft`, `--accent-strong`, `--accent-border`, `--green`, `--yellow`, `--red`, `--cyan`.
- Shape and motion: `--r-*`, `--ease*`, `--t-*`.
- App/PWA layout: `--side-w`, `--topbar-h`, `--mobile-app-bar-h`, `--mobile-nav-h`, safe-area vars, `--kb-inset`.

## Interaction rules

- Headers stay roman; no italic headings.
- No gradient text, no decorative orbs, and no fake browser/phone chrome.
- Do not fabricate metrics, testimonials, or benchmark claims.
- Prefer tokens over new one-off values. Legacy raw values can remain only when outside the touched UI surface.
- Coarse-pointer UI controls must expose at least a 44px hit area without forcing desktop density to change.
- Chat scroll affordances are CSS-owned inside `.messages`, not inline magic positioning.
- Active states use a small indigo marker or subtle paper tint, not full-row saturated fills.
- Terminal output stays dark for readability even when the surrounding shell is light.

## PWA behavior

- `public/sw.js` owns app-shell route caching and must include first-class navigation destinations.
- Offline content uses named PWA classes and remains readable as a document fallback.
- The installed shell should avoid horizontal scroll, respect safe areas, and preserve user zoom.
