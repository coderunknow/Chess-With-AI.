# AI Chess Companion ♞ — Chess With AI

> Play chess against Gemini, ChatGPT, Claude, Grok, Perplexity or Copilot — from Chrome's side panel.

AI Chess Companion is a Manifest V3 Chrome extension that puts a full chess board next to your AI chat.
You play one colour, the AI plays the other, and the extension does the bookkeeping:

- it validates every move with a complete local chess engine (castling, en passant, promotion, pins, checks),
- it types a structured prompt with the current FEN into the chat you already have open,
- it reads the AI's reply, extracts the move, and updates the board if the move is legal.

**No backend. No API keys. No telemetry. Everything runs locally.**

---

## ✨ Features

- **Side panel board** — scales from a narrow panel to a wide pop-out, with keyboard navigation
- **Six AI platforms** — Gemini, ChatGPT, Claude, Grok, Perplexity, Microsoft Copilot
- **Complete chess rules** — legal move generation, castling, en passant, promotion (with a chooser), check/checkmate, stalemate, fifty-move rule, threefold repetition, insufficient material
- **Plays both colours** — play White, or take Black and let the AI open
- **Move list and PGN** — live move list, copy or load a full PGN, export with the final result
- **Automatic recovery** — if the AI answers with an illegal move, the extension sends a corrected request (bounded, configurable)
- **Resumable games** — the position survives a panel reload through `chrome.storage.local`
- **Undo, flip, theme** — take back a move pair, flip the board, switch between dark and light themes
- **Privacy first** — the only network traffic is the chat prompt you already send to your AI

## 🧩 How it works

```
┌────────────────────┐  SEND_CHESS_PROMPT   ┌──────────────────┐   types + submits   ┌──────────────┐
│  Side panel (ESM)  │ ───────────────────▶ │  Content script  │ ──────────────────▶ │   AI chat    │
│  engine + UI       │                      │  bridge/observer │                     │              │
│                    │ ◀─────────────────── │                  │ ◀────────────────── │  AI reply    │
└────────────────────┘        AI_MOVE       └──────────────────┘   MutationObserver  └──────────────┘
        │                                              ▲
        │ GET_ACTIVE_TAB                               │ dynamic import of the ESM graph
        ▼                                              │
┌────────────────────┐                    ┌────────────────────────────┐
│ Service worker     │  side panel setup  │ web_accessible_resources   │
│ badge + panel      │                    │ (validated by CI)          │
└────────────────────┘                    └────────────────────────────┘
```

1. **`src/core/`** — a dependency-free chess engine (position, move generation, SAN/PGN). It is pure ES modules and runs identically in Node and in the browser.
2. **`src/shared/`** — the platform registry, message contract, prompt builder and settings. `src/shared/platforms.js` is the single source of truth for the hosts the extension supports.
3. **`src/background/`** — panel behaviour, toolbar badge, and the "which tab should I talk to?" answer.
4. **`src/content/`** — `index.js` is the classic bootstrap that dynamically imports the ESM graph; `bridge.js` drives each site's composer; `observer.js` watches the transcript for the AI's move.
5. **`src/ui/`** — the side panel: `game.js` (session/turn/undo/retry model), `board.js` (render model + view), `history.js`, `status.js`, `app.js` (orchestration).

The prompt protocol is deliberately strict, so replies are easy to parse:

```
Chess move request. You are playing BLACK. The human plays White.
Position (FEN): r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3
Moves so far: 1. e4 e5 2. Nf3 Nc6
The human just played Nc6 ([b8c6]).
Choose exactly one legal move for BLACK in the FEN position above.
Reply with that move in square brackets using coordinate notation, for example [g8f6] or [e7e8q] for a promotion.
Put the bracketed move first. Do not mention any other move.
```

## 📦 Installation

### Load unpacked (development)

```bash
git clone https://github.com/coderunknow/Chess-With-AI.git
cd Chess-With-AI
```

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the repository folder
4. Pin **AI Chess Companion** to the toolbar

There is no build step: the repository is the extension. Node is only needed for tests and tooling.

### From the Chrome Web Store

> Coming soon — see `docs/STORE_LISTING.md`.

## 🎮 Usage

1. Open a supported AI chat: `gemini.google.com`, `chatgpt.com`, `claude.ai`, `grok.com`, `www.perplexity.ai` or `copilot.microsoft.com`.
2. Click the extension icon — the side panel opens and the toolbar badge shows `AI` when the active tab is supported.
3. Play as White: click a piece, then a highlighted destination. Promotions open a piece chooser.
4. The extension sends the FEN and your move to the active chat. When the AI answers with `[e7e5]`, the board updates.
5. Use **Undo**, **New game**, **Flip**, **Copy PGN** or the **PGN…** dialog as needed. Settings lets you switch sides and turn the automatic retry on or off.

> **Tip:** the opening prompt already tells the AI the protocol. If a model still rambles, reply once with
> _"Always answer with exactly one move in brackets, like [e7e5]."_ — the extension picks up the bracketed move and ignores the prose.

## 🗂️ Repository layout

```
.
├── manifest.json           # generated host lists — see npm run sync:manifest
├── sidepanel.html          # side panel markup (the only HTML entry point)
├── src
│   ├── core/               # chess engine: position, moves, FEN, SAN/PGN
│   ├── shared/             # platforms, messaging, prompts, settings, storage, logging
│   ├── background/         # service worker: panel behaviour, badge, active tab
│   ├── content/            # AI chat bridge, transcript observer, DOM helpers
│   └── ui/                 # side panel app: game model, board, history, status, theme
├── test/                   # node:test suites plus DOM/Chrome doubles
├── scripts/                # manifest check/sync, packaging, smoke test
├── docs/                   # architecture, development, FAQ, store listing
└── icons/                  # 16/48/128 px extension icons
```

## 🔧 Development

```bash
npm ci            # dev dependencies (eslint, prettier) — the extension itself has none
npm test          # node:test suites, no browser required
npm run lint      # eslint
npm run format    # prettier
npm run verify    # manifest check + lint + format check + tests
npm run package   # build/ai-chess-companion-<version>.zip for the store
```

Reloading after a change: click **Reload** on the extension card in `chrome://extensions/`, then reload the AI chat tab.
The side panel picks up its own changes on reopen.

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the architecture walkthrough, the per-platform selector tables, and how to add a new AI host.

## ✅ Quality

| Area              | How it is verified                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Move generation   | `perft` node counts from the Chess Programming Wiki for six positions                                                        |
| Rules edge cases  | Unit tests for pins, castling through check, en passant legality, promotion, draws                                           |
| SAN/PGN           | Morphy's Opera Game replayed move by move; import/export round trips                                                         |
| Panel behaviour   | Full orchestration tests against DOM and `chrome.*` doubles                                                                  |
| Markup/code drift | Tests assert every `#id` the code uses exists in `sidepanel.html`                                                            |
| Manifest          | `npm run check:manifest` — hosts, permissions, versions and the dynamically imported module graph                            |
| Supply chain      | No runtime dependencies; the packaged archive contains only `manifest.json`, `sidepanel.html`, `src/`, `icons/` and licences |

## 🔒 Privacy

See [PRIVACY.md](./PRIVACY.md). In short: no analytics, no servers, no accounts. Game state and settings live in
`chrome.storage.local`. The only data that leaves your browser is the chess prompt typed into your own AI chat.

## 🤝 Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
Good first issues: a new AI platform, a new board theme, translations, or drag-and-drop pieces.

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## 🆘 Support

See [SUPPORT.md](./SUPPORT.md) and [docs/FAQ.md](docs/FAQ.md).

## 📜 License

MIT — see [LICENSE](./LICENSE). Copyright (c) 2026 coderunknow.

## 🙏 Acknowledgements

- [Perft reference counts](https://www.chessprogramming.org/Perft_Results) — Chess Programming Wiki
- Unicode chess glyphs, which keep the board dependency-free
- Everyone playing chess with a language model instead of against an engine
