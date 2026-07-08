# HermesDeck WebUI Kit

Partial/stale prototype of the HermesDeck WebUI. Treat it as design reference only; verify behavior and coverage against current `src/app/*` before reusing anything.

## Files

- `index.html` — interactive demo. Loads React + Babel from CDN and stitches the components together. Try: switching nav, clicking a session in the sidebar, typing into the composer, hitting `/` to open the slash menu.
- `AppShell.jsx` — sidebar + topbar + (collapsed) mobile bottom nav. Bilingual nav labels, lucide icons, brand badge with live status dot.
- `Dashboard.jsx` — Command Deck page: hero card, metric cards, sparkline, top-models bar list, recent sessions list.
- `ChatView.jsx` — sessions panel + thread with inline tool cards, plus the slash-command-aware composer. Current product no longer has a right-side run-events timeline rail; raw non-delta Agent API events appear only in the main transcript when tool details are enabled, while the right rail is reserved for context/inspector observability.
- `Terminal.jsx` — terminal prototype surface. Current product semantics include bounded terminal actions and an opt-in `super_admin/local-owner` Live Terminal real shell (`HERMESDECK_LIVE_TERMINAL=1`) backed by tmux/node-pty; verify behavior against `src/components/LiveTerminal.tsx` before reuse.
- `Primitives.jsx` — `Card`, `Tag`, `Kicker`, `MetricCard`, `BarRow`, `Sparkline`, `Btn`, `Icon` — used by every screen.

## Coverage

- ✅ Dashboard (Command Deck)
- ✅ Chat (sessions list + thread with inline tool cards)
- ✅ Terminal (bounded actions + Live Terminal reference)
- ⚠️ Agents / Tools / Settings — prototype coverage is partial and may lag current source. Check `src/app/*` for current product behavior; there is no current standalone `/models` page.

## Caveats

- This is a partial recreation; nothing is wired to a real backend. All data is hard-coded sample data.
- Code-block syntax highlighting is faked with hand-rolled spans; current product code uses `rehype-highlight` / `highlight.js`.
- The `lucide` icon set is loaded as inline SVG (a curated subset — see `Primitives.jsx`'s `Icon` component).
