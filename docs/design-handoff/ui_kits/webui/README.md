# HermesDeck WebUI Kit

Pixel-faithful recreation of the HermesDeck WebUI — the Hermes-native multi-session AI chat with profile/run awareness. All components are derived directly from `src/app/globals.css` and the live page components in `src/app/`.

## Files

- `index.html` — interactive demo. Loads React + Babel from CDN and stitches the components together. Try: switching nav, clicking a session in the sidebar, typing into the composer, hitting `/` to open the slash menu.
- `AppShell.jsx` — sidebar + topbar + (collapsed) mobile bottom nav. Bilingual nav labels, lucide icons, brand badge with live status dot.
- `Dashboard.jsx` — Command Deck page: hero card, metric cards, sparkline, top-models bar list, recent sessions list.
- `ChatView.jsx` — sessions panel + thread + timeline rail, plus the slash-command-aware composer.
- `Terminal.jsx` — Safe Ops console with allowlisted commands.
- `Primitives.jsx` — `Card`, `Tag`, `Kicker`, `MetricCard`, `BarRow`, `Sparkline`, `Btn`, `Icon` — used by every screen.

## Coverage

- ✅ Dashboard (Command Deck)
- ✅ Chat (sessions list + thread + timeline)
- ✅ Terminal (Safe Ops)
- ⏸️ Profiles / Models / Runs / Tools / Settings — these pages exist in the codebase but are mostly empty/planned in the source; we reference their shells but don't recreate them.

## Caveats

- This is a recreation; nothing is wired to a real backend. All data is hard-coded sample data.
- Code-block syntax highlighting is faked with hand-rolled spans (the real product uses shiki/prism).
- The `lucide` icon set is loaded as inline SVG (a curated subset — see `Primitives.jsx`'s `Icon` component).
