# HermesDeck Hallmark Design System

Date: 2026-06-16
Scope: HermesDeck web app and installed PWA shell.

This file documents UI/design constraints only. Runtime architecture, API-only data flow, RBAC and deployment live in README and `docs/*`.

## Product stance

- HermesDeck is a Hermes Agent control deck, not a marketing site.
- Primary surfaces are cockpit/workbench pages: dashboard, chat, profiles, tools, config, cron, terminal, settings and LCM.
- Navigation is persistent app chrome: desktop side rail/top command bar, mobile app bar/bottom nav.
- PWA/mobile priorities: safe areas, no horizontal scroll, stable chat scrollport, two-level mobile chat, 44px coarse-pointer hit targets.

## Visual DNA

- Modern-minimal, light-first paper UI with restrained dark terminal/code areas.
- Tally-style references are high-level visual inspiration only; do not copy content, metrics, pricing, customer names or pixel layouts.
- Paper, not glass: neutral backgrounds, hairline borders, low-shadow popovers.
- Accent footprint is small: indigo for active markers, focus, links, selected controls.
- Rows and panels should read as structured documents: clear titles, muted metadata, mono counters, right-aligned values where helpful.
- Empty states must explain the current state and next action.

## Tokens

Production tokens live in `src/app/globals.css`. Portable mirrors are audit artifacts only and should not be imported unless build tooling is intentionally changed.

Core aliases:

- Fonts: `--font-sans`, `--font-mono`.
- Paper/ink/accent/companion colors.
- Legacy mapped aliases: `--bg`, `--panel`, `--card-bg`, `--text`, `--muted`, `--accent`, `--green`, `--yellow`, `--red`, `--cyan`.
- Shape/motion/layout: `--r-*`, `--ease*`, `--t-*`, `--side-w`, `--topbar-h`, `--mobile-app-bar-h`, `--mobile-nav-h`, safe-area vars, `--kb-inset`.

Prefer tokens over one-off values. Do not add raw colors to touched surfaces unless there is a documented exception.

## Interaction rules

- Headers stay roman; no italic headings.
- No gradient text, decorative orbs or fake browser/phone chrome.
- Do not fabricate metrics, testimonials or benchmark claims.
- Active states use a small marker or subtle paper tint, not saturated full-row fills.
- Terminal output stays dark for readability even inside a light shell.
- Chat scroll affordances are CSS-owned inside `.messages`, not inline magic positioning.
- Avoid horizontal overflow on mobile and installed PWA.

## PWA UI behavior

`public/sw.js` owns only safe cache behavior. UI assumptions:

- The offline page is a public document fallback and must be readable without auth data.
- Protected/authenticated navigation pages must render from network, not stale cache.
- The installed shell should preserve user zoom, safe areas and keyboard inset behavior.
- Update prompts should avoid interrupting active streaming chat.
