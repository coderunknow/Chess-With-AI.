# Icons

This folder contains generated icons for AI Chess Companion.

- `icon16.png` — 16x16 toolbar icon
- `icon48.png` — 48x48 extension management page
- `icon128.png` — 128x128 Chrome Web Store

## Status in v1.0.0

`manifest.json` in v1.0.0 does **not** reference these icons to keep source code unchanged for this release (per task requirement). They are ready for v1.0.1.

To wire them, add to `manifest.json`:

```json
"icons": {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
},
"action": {
  "default_icon": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "default_title": "Open AI Chess Companion"
}
```

## Design

- Dark background #101317 matching side panel
- White knight with subtle blue glow #71b7ff
- Minimal sparkle for AI feel
- No text, high contrast, works at small sizes

Replace with custom design if you prefer — keep MIT license compatible.
