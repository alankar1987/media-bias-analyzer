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

## Limits in v1

- Anonymous only — no sign-in, no quota tracking, no history sync to veris.news
- No auto-detect on news sites; user must click the toolbar icon
- No alt-coverage / framing accordion in the popup
- Not yet on the Chrome Web Store
