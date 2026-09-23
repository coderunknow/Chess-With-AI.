# Development Guide

## Quick Start

No build tools needed.

1. Clone
   ```bash
   git clone https://github.com/coderunknow/Chess-With-AI.git
   cd Chess-With-AI
   ```
2. Open `chrome://extensions`, enable Developer Mode, Load unpacked → select folder
3. Open https://gemini.google.com, click extension icon
4. Play!

## Reloading

After editing:
- `chrome://extensions` → Reload button on extension card
- Reload AI chat tab
- Side panel will re-render

## Debugging

### Side Panel
Right-click side panel → Inspect → Console / Elements

### Content Script
Open AI chat tab → F12 → Console → filter "AI Chess"

### Service Worker
`chrome://extensions` → Service Worker → Inspect → Console

## Testing Checklist

- [ ] White can only move when it's white's turn
- [ ] Illegal moves rejected with status error
- [ ] Legal targets highlighted (dot for move, ring for capture)
- [ ] Last move highlighted
- [ ] Castling works when rights present and not through check
- [ ] En passant works only immediately after double push
- [ ] Promotion auto-queens (currently)
- [ ] FEN updates correctly
- [ ] Reset button clears board
- [ ] Move sends to AI tab — prompt appears in AI input and auto-sends
- [ ] AI reply `[e7e5]` updates board
- [ ] Duplicate AI moves debounced
- [ ] Panel only enabled on whitelisted hosts
- [ ] Works on at least 2 hosts (Gemini + ChatGPT recommended)

## Adding a New AI Host

1. Add host to `AI_HOSTS` in `background.js`
2. Add to `host_permissions` and `content_scripts.matches` in `manifest.json`
3. Add to `AI_HOSTS` in `sidepanel.js` (if you want consistent check)
4. Test input detection — if new host uses custom input, add selector to `INPUT_SELECTORS` and send button to `SEND_SELECTORS` in `content.js`
5. Document in README + PRIVACY + STORE_LISTING

## Code Style

- 2 spaces indent
- No semicolon wars — keep existing style (semicolons present)
- Use `textContent`, not `innerHTML` for untrusted data
- Validate UCI with regex before use
- Keep permissions minimal

## Adding Icons (TODO)

Manifest currently has no icons. To add:

1. Create `icons/` folder with `icon16.png`, `icon48.png`, `icon128.png`
2. Add to `manifest.json`:
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
3. Test loading

## Packaging for Store

```bash
# Create zip for Chrome Web Store upload (exclude .git, docs, .github)
zip -r ai-chess-companion.zip . -x "*.git*" "docs/*" ".github/*" "*.DS_Store" "node_modules/*" "*.zip"
```

## No Dependencies Policy

Keep zero deps. If you need to add a build step (e.g., for Stockfish WASM), open an issue first and document rationale.

## Useful References

- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome Scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- UCI notation: https://en.wikipedia.org/wiki/Universal_Chess_Interface
- FEN: https://en.wikipedia.org/wiki/Forsyth%E2%80%93Edwards_Notation
