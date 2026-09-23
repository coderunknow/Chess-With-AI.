# Chrome Web Store Listing — AI Chess Companion

## Short Name

AI Chess Companion

## Detailed Name

AI Chess Companion — Chess With AI

## Summary (132 chars max)

Play chess alongside Gemini, ChatGPT, Claude, Grok & more. Side panel board, auto prompts, parses AI moves. Privacy-first.

## Description (Full)

**Play chess WITH your favorite AI, not just against a bot.**

AI Chess Companion adds a beautiful chess board to Chrome's side panel while you chat with Gemini, ChatGPT, Claude, Grok, Perplexity, and Copilot. You are White, AI is Black. Your moves are automatically sent to the AI, and AI's replies like `[e7e5]` are parsed to update the board.

### Features

♞ Side panel board — always visible alongside chat
🤖 Works with Gemini, ChatGPT, Claude, Grok, Perplexity, Copilot
⚡ Auto prompting — sends FEN + UCI move to AI
👁️ Smart parsing — watches AI responses for [e2e4] moves
♔ Full chess rules — castling, en passant, promotion, check detection
🔒 Privacy first — no servers, no tracking, 100% local
🎨 Dark theme, Unicode pieces, legal-move highlights

### How to Use

1. Open gemini.google.com, chatgpt.com, claude.ai, grok.com, perplexity.ai or copilot.microsoft.com
2. Click the extension icon to open side panel
3. Play as White — click piece then destination
4. Your move [e2e4] + FEN is auto-sent to AI
5. AI replies with [e7e5] — board updates!
6. Tip: Tell AI "Always reply with move in brackets like [e7e5]"

### Privacy

No data collection. No analytics. No external servers. Chess engine runs locally. Only prompts you send to your chosen AI chat leave the browser.

### Permissions Explained

- `sidePanel`: show the chess board beside the chat
- `storage`: keep your settings and the running game on your own device
- `scripting`: inject the bridge on AI pages if the tab was opened before the extension was installed
- Hosts: only the AI chat domains listed above — no `<all_urls>`, no browsing-history access

### Open Source

MIT licensed. GitHub: github.com/coderunknow/Chess-With-AI

---

## Category

Games / Fun

## Language

English

## Screenshots Needed (1280x800 or 640x400)

1. Board on Gemini with move sent
2. Board on ChatGPT with AI reply [e7e5]
3. Legal move highlights + FEN display
4. Dark theme closeup + reset button
5. Supported AI logos grid

## Icon Sizes

- 16x16, 48x48, 128x128 PNG are in `icons/` and wired into `manifest.json`
- Source artwork: glowing knight on the panel background colour (`#101317`)

## Privacy Tab Answers

**Single purpose:** Play chess with AI chat assistants via side panel board that bridges UCI moves.

**Permissions justification:** Already in description.

**Data usage:**

- Does not collect user data
- Does not use remote code

**Host permissions justification:** Need to inject content script to automate typing move prompts into AI chat inputs and observe AI responses for UCI moves. Only whitelisted AI domains.

## TODO Before Submission

- [x] Create icons (16/48/128) and wire them into `manifest.json`
- [ ] Take 3–5 screenshots at 1280x800
- [ ] Add promotional tile 440x280 (optional), marquee 1400x560 (optional)
- [ ] Run the manual checklist in `docs/DEVELOPMENT.md` on every supported host
- [ ] Host the privacy policy (link to `PRIVACY.md`, or a rendered copy)
- [ ] Upload `build/ai-chess-companion-0.1.0.zip` produced by `npm run package`
