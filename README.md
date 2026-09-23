# AI Chess Companion ♞ — Chess With AI

> Play chess alongside Gemini, ChatGPT, Claude, Grok, Perplexity, and Copilot — directly from your AI chat tab.

AI Chess Companion is a Chrome Extension (Manifest V3) that opens a beautiful chess board in the side panel while you chat with any major AI assistant. You play as White, the AI plays as Black. Your moves are automatically sent to the AI chat, and the AI's replies are parsed for UCI moves like `[e7e5]` to update the board.

**No backend. No data collection. 100% local.**

---

## ✨ Features

- **Side Panel Chess Board** — Dark-themed, responsive board that lives alongside your AI chat
- **Multi-AI Support**:
  - Google Gemini
  - ChatGPT (chatgpt.com & chat.openai.com)
  - Claude.ai
  - Grok.com
  - Perplexity.ai
  - Microsoft Copilot
- **Automatic Prompting** — Converts your move + FEN to a structured prompt for the AI
- **Smart Move Parsing** — Watches AI responses for bracketed UCI notation e.g. `[g8f6]`
- **Full Chess Rules** — Legal move validation, castling, en passant, promotion, check detection
- **Zero Permissions Creep** — Only `sidePanel`, `activeTab`, `scripting` + host permissions for supported AI sites
- **Privacy First** — No analytics, no servers, no API keys

## 🧩 How It Works

```
[Side Panel]  --(UCI + FEN)-->  [Content Script]  --injects prompt-->  [AI Chat Input]
     ^                                                                    |
     |                                                                    v
     +--(parses [e2e4])<----  MutationObserver on AI response  <---- [AI Response]
```

1. **background.js** — Service worker that enables the side panel only on supported AI hosts and handles `openPanelOnActionClick`.
2. **content.js** — Injected into AI chat pages. Finds the chat input (textarea/contenteditable), populates it, clicks send, and observes DOM mutations for AI moves in `[fromTo]` format.
3. **sidepanel.html / sidepanel.js** — Full chess engine UI:
   - Parses FEN, validates pseudo-legal and legal moves
   - Checks for check, pins, castling rights
   - Renders board with Unicode glyphs ♔♕♖♗♘♙
   - Sends `SEND_CHESS_PROMPT` to content script
   - Listens for `AI_MOVE` events

UCI Format Expected: `[e2e4]`, `[g1f3]`, `[e7e8q]` for promotions.

## 📦 Installation

### Load Unpacked (Developer Mode)

1. Clone this repo:
   ```bash
   git clone https://github.com/coderunknow/Chess-With-AI.git
   cd Chess-With-AI
   ```
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → Select this project folder
5. Pin **AI Chess Companion** to your toolbar

### From Chrome Web Store

> Coming soon. The extension is ready for store submission — see `docs/STORE_LISTING.md`.

## 🎮 Usage

1. Open any supported AI chat:
   - `https://gemini.google.com`
   - `https://chatgpt.com` / `https://chat.openai.com`
   - `https://claude.ai`
   - `https://grok.com`
   - `https://www.perplexity.ai`
   - `https://copilot.microsoft.com`
2. Click the extension icon → Side panel opens with the board
3. Play as White — click a piece, then a highlighted destination
4. Your move is auto-sent to the AI as:
   ```
   You are the black side in a chess game.
   The human just played [e2e4].
   Current position (FEN): rnbqkbnr/pppppppp/8/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1
   Choose one legal move for Black...
   Return the move in UCI coordinate notation inside square brackets...
   ```
5. Wait for AI to reply with e.g. `[e7e5]` — board updates automatically
6. Continue! Use **Reset game** anytime.

> **Tip:** Tell your AI at the start: *"Let's play chess. Always reply with your move in brackets like [e7e5]."* The extension already instructs this, but a nudge helps.

## 🗂️ Project Structure

```
.
├── manifest.json      # Manifest V3 config — permissions, side_panel, content_scripts
├── background.js      # Service worker — panel enablement, tab tracking
├── content.js         # AI chat bridge — input detection + response observer
├── sidepanel.html     # Board UI + styles (dark theme)
├── sidepanel.js       # Chess engine + UI logic + messaging
├── README.md          # This file
├── LICENSE            # MIT License
├── CHANGELOG.md       # Version history
├── CONTRIBUTING.md    # How to contribute
├── CODE_OF_CONDUCT.md # Community guidelines
├── SECURITY.md        # Security policy
├── PRIVACY.md         # Privacy policy
├── SUPPORT.md         # Help & support
└── .github/           # Issue templates & PR template
```

No build step, no bundler, no dependencies. Pure vanilla JS.

## 🔧 Development

### Requirements
- Chrome 114+ (Side Panel API support)
- No npm install needed

### Local Development
1. Make changes to any file
2. Go to `chrome://extensions/` → Click **Reload** on AI Chess Companion
3. Reload your AI chat tab

### Key Implementation Details

**Move Validation (`sidepanel.js`):**
- `parseFen()` → `emptyBoard()` → board dictionary
- `isPseudoLegalMove()` handles pawn, knight, bishop, rook, queen, king + castling
- `isSquareAttacked()` + `isInCheck()` → `isLegalMove()` clones state and tests for king safety
- `makeMoveUnchecked()` updates castling rights, en passant, halfmove/fullmove

**AI Chat Injection (`content.js`):**
- `INPUT_SELECTORS`: textarea, contenteditable, role=textbox — sorted by viewport bottom
- `setNativeValue()` uses prototype setter to trigger React-controlled inputs
- `populateInput()` + `submitInput()` → tries send button click, falls back to Enter key events
- `MutationObserver` watches `document.body` subtree for assistant message nodes

**Panel Lifecycle (`background.js`):**
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
- `tabs.onUpdated` / `onActivated` enables panel only on whitelisted hosts

## 🔒 Privacy

See [PRIVACY.md](./PRIVACY.md). TL;DR:
- No data leaves your browser except the chess prompts you already send to your chosen AI
- No analytics, no tracking, no external servers
- All chess logic runs locally in the side panel

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

Ideas:
- Add more AI hosts
- Piece promotion chooser UI
- Move history & PGN export
- Stockfish evaluation as optional helper
- Themes, sound, drag-and-drop
- Icons & better a11y

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## 🆘 Support

See [SUPPORT.md](./SUPPORT.md) — how to file bugs, get help, and FAQ.

## 📜 License

MIT License — see [LICENSE](./LICENSE). Copyright (c) 2026 coderunknow.

## 🙏 Acknowledgments

- Chess Unicode glyphs for zero-dependency rendering
- Inspired by the idea of playing chess *with* LLMs, not against a hardcoded engine
- Thanks to all AI platforms that make conversational chess possible

---

**Enjoy!** If you like this, please ⭐ star the repo and share it.
