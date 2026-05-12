# Veris Chrome Extension

A toolbar Chrome extension (MV3) that analyzes the article in the active tab
through the Veris backend at `https://media-bias-analyzer-production.up.railway.app`.

## Load unpacked (development)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked** and select this `extension/` folder
4. Pin the extension from the puzzle-piece menu in the toolbar

## Use it

1. Navigate to a news article
2. Click the Veris toolbar icon
3. Click **Analyze this page**
4. Wait ~5–15s for the result card

## Layout

```
extension/
├── manifest.json          MV3 manifest
├── popup/                 popup HTML/CSS/JS state machine
├── background/            service worker (per-tab result cache)
├── lib/api.js             /analyze client
└── icons/                 16/32/48/128 PNGs (rasterized from veris-appicon.svg)
```

## Backend dependency

The extension calls `POST /analyze` with `{url}` and expects the existing
JSON envelope (`{success, data, error, source_url}`). CORS for
`chrome-extension://*` origins is granted in `backend/main.py`.

## Current scope (v1.0.0)

- Sign in with Google — analyses count against your veris.news quota and
  appear at `veris.news/#history`
- Anonymous use still works (no quota tracking, capped by Anthropic rate
  limits + per-URL cache)
- "Broaden Your View" alt-coverage cards
- Color-coded Lean / Tone / Facts scores matching the website

## Not yet implemented

- Auto-detect on news sites; user must click the toolbar icon
- Framing accordion / per-claim breakdown (use "Open full report ↗")
- Token refresh — Supabase access tokens last 1h; expired sessions
  prompt the user to sign in again
