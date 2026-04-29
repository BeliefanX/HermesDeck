# HermesDeck

HermesDeck is a clean Hermes-native WebUI. It uses ClawDeck and open-webui as product references only; runtime code is not based on OpenClaw/ClawDeck.

## Run

```bash
cd ~/HermesDeck
npm install
PORT=6117 npm run dev
# or after build
npm run build
PORT=6117 npm start
```

Open: http://10.10.10.253:6117/

## PWA / Mobile

HermesDeck includes a PWA manifest, service worker, offline fallback page, mobile icons, mobile bottom navigation, safe-area support, and phone-friendly chat layout.

Verification:

```bash
npm run verify:pwa
npm run typecheck -- --pretty false
npm run build
curl -I http://127.0.0.1:6117/manifest.webmanifest
curl -I http://127.0.0.1:6117/sw.js
```

Important: browser PWA install and service worker registration require a secure context. `http://10.10.10.253:6117` works as a mobile web UI, but true PWA installation requires HTTPS or localhost. See `docs/pwa-mobile.md` for deployment notes.

## Backend model

- Primary chat/runtime: Hermes API Server (`/v1/responses`, `/v1/chat/completions`, `/v1/runs`).
- Admin/history/config: Hermes native dashboard/session/config APIs or local Hermes state inspection.
- CLI is used only for local profile discovery and fallback when the API server is not available.

Environment overrides:

```bash
HERMES_API_BASE=http://127.0.0.1:8642
HERMES_API_KEY=***
HERMES_DASHBOARD_BASE=http://127.0.0.1:9120
```

Legacy prototype backup: `~/HermesDeck-legacy-clawfork`.
