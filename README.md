# AI Chess Companion ♞ — Chess With AI

> Play chess with Gemini, ChatGPT, Claude, Grok, Perplexity or Copilot in Chrome's side panel.

**v0.7.0** is a zero-build Manifest V3 extension. You play one colour and the AI in your **pinned** chat plays the other. The local chess rules engine validates every move (including castling, en passant, promotion, checks and draws). The extension sends a FEN-based request to that one chat and reads the AI's _new_ reply. No account, API key, backend, analytics or telemetry is required.

## Features

- **Board alongside chat:** 280–900px side panel, keyboard navigation, drag/drop and tap-once; Unicode pieces, existing classic/blue/green/high-contrast boards, light/dark/system UI and English/Vietnamese. Optional 180ms piece glide respects reduced motion.
- **Six supported platforms:** Gemini, ChatGPT, Claude, Grok, Perplexity and Microsoft Copilot. Choose exactly **one supported tab** in **AI chat connections**; the picker shows its platform, host and title from the content script. Focusing another tab does not change the pin.
- **Safe one-shot send:** waits for a generating/Stop control to disappear (default 120s), verifies the _entire_ prompt in the composer and uses **one** submit method. A click is never followed by Enter. Ambiguous sends stop with a Copy prompt action; they are never retried by keystroke. **Manual** send mode copies the prompt for you to paste/send; it never types or clicks in the chat, but still watches for your reply.
- **Explained illegal moves:** the status names the broken rule (pin, castle-through-check, missing promotion, etc.). Bounded corrections give the AI the legal moves in non-parseable `e2-e4` form. When retries run out, **Ask again** sends one correction; a local engine never substitutes an AI move.
- **Your choice of side:** **Play Black / Play White** next to Flip starts a _new_ game (confirmation if moves exist). Black flips the board. There is no mid-game colour swap.
- **Soft Pause / Resume:** Pause stops the transcript observer and both workers while leaving the content script installed; toolbar badge `OFF` wins over turn/check badges. Pause persists across service-worker restarts. Closing the panel does not auto-pause.
- **Games and analysis:** local snapshot, PGN import/export, game library, optional clock (default 5 minutes per side), synthesized wood knocks (off by default, volume adjustable), Hint / Analyse / local Play vs engine at **heuristic levels 1–8**. These levels have **no calibrated Elo**.
- **AI Battle (unrated):** pin your chat as usual, then let a second **battle-only opponent slot** play it in a full clocked game (default 5+0, 1–60 min, increments 0/2/3/5 s). Both AIs get their remaining time in the prompt. Illegal replies are retried a bounded number of times per side and then the battle **pauses** with **Ask again / Abort / Export** — a move is never fabricated. Unfinished battles leave no ledger entry; results cover checkmate, resignation, flag, draw and adjudicated draws at the ply limit. A W–D–L ledger per tab-pair, one-click rematch and paired PGN export are included. **Battles are unrated** and never touch rated match records.
- **Efficient & Fun response styles:** Efficient returns only the bracketed UCI move; Fun adds 1–2 slider-controlled witty sentences after the move — the move parsing and chess logic are identical in every style.
- **Prompt Studio & Latency Timeline:** see the exact prompt the extension sends (with platform, style toggle, char/line count and budget warning) and per-move stage timings (ms deltas only — never message text) under Diagnostics. Both are strictly local.
- **Rated Stockfish match:** the **vendored Stockfish.js 17.1 Lite single-threaded NNUE WASM** plays real chess moves against the AI in the pinned tab. Match settings use `UCI_LimitStrength true`, the binary's own `UCI_Elo` range and `go movetime`; no Skill Level/depth-to-Elo conversion. The model's legal replies must come from that pinned tab. Only completed chess outcomes or a parsed resignation after both sides have played count. Unfinished games, protocol errors, pause or Stop never count as losses. Each anchor has its own **game count, W–D–L, bounded maximum-likelihood estimate and 95% interval**; small or wide-interval samples say **provisional**. **Stockfish UCI_Elo scale, not FIDE** (nor a website rating).

## Install (no compile step)

```bash
git clone https://github.com/coderunknow/Chess-With-AI.git
cd Chess-With-AI
```

1. Visit `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked**, select this folder.
2. Open one of the supported AI chats and click the extension icon to open the side panel.
3. Expand **AI chat connections** and **pin** the conversation you want. The opponent line confirms the pinned platform/title.
4. Play a move as White, or use **Play Black** to start a new game and **Ask the AI to move**. The reply contract is one bracketed coordinate move, e.g. `[e7e5]`.
5. For rated play, select **Auto** send mode, keep the pinned tab live, and choose an anchor/move time in **Settings → Engine**. The binary must finish booting before **Start rated game** is enabled. Each match replaces the current game after confirmation.

If a site is still generating, wait for it to finish. **Never press Enter to “wake” a model**. A timeout or unconfirmed send offers **Copy prompt**, without a second click/Enter. In Manual mode paste and submit the copied text yourself; the observer waits for the full user message before accepting a new assistant reply. If an Auto send could not be confirmed, the extension never resends: the reply is still accepted as soon as it can be attributed to that one send (the matching echo appears, or the AI answers in a new message after it). A reply with no readable move shows an honest “no move” state with **Ask again**; the local engine never plays for the AI.

### How it works

```text
Side panel (GameSession + rules + UI) ── SEND_CHESS_PROMPT ──▶ pinned tab's content bridge
       ▲                 │                                  │ one-shot send; no Stop click
       │        local heuristic worker                     ▼
       │        (Hint / Analyse only)                 your own AI chat
       │                 │                                  │ new assistant container
       └──────── AI_MOVE from pinned tab ◀────────── transcript observer
                         │
              Rated match ONLY: packaged Stockfish WASM worker supplies the OTHER colour
              after its UCI_Elo handshake; neither worker plays the chat AI's turn.
```

The opening/move/retry prompts include a FEN, an explicit side-to-move line and a strict one-bracketed-move reply contract, and ask the AI to show that move in its visible reply as plain text (not in a code block) so it can be read back. When the AI is to move first, the opening prompt asks for that move immediately. Echoes of the request and quoted legal-move lists cannot become moves. The user's chat service receives the prompt just as it would if you sent it by hand.

## Development and quality

```bash
npm ci               # dev-only ESLint and Prettier; zero runtime npm dependencies
npm test             # node:test, including perft and integration doubles
npm run verify       # manifest, lint, formatting, tests
npm run package      # build/ai-chess-companion-0.6.0.zip
```

The folder itself is loadable: **no bundler, CDN or runtime download**. `manifest.json` host lists come from `src/shared/platforms.js` (`npm run sync:manifest`). Tests assert full perft counts, board interaction and scroll isolation, CSP-safe markup, the web-accessible content module graph, absence of remote network APIs in that graph, the submit contract, observer provenance, pin/pause, UCI option/range parsing, **execution of the vendored Stockfish WASM bytes**, a real-game match flow and estimator math. See [development guide](docs/DEVELOPMENT.md) and [architecture](docs/ARCHITECTURE.md).

```
manifest.json · sidepanel.html · src/{core,shared,background,content,ui}
engine/stockfish/      # vendored GPL-3 JS/WASM, COPYING, AUTHORS, SOURCE.md and exact Lite source bundle
_locales/{en,vi}/      # locale metadata; runtime dictionary lives in src/shared/i18n.js
test/ · scripts/ · docs/
```

## Privacy and licensing

See [PRIVACY.md](PRIVACY.md): only declared AI hosts are read, supported-tab titles and the single pin stay in browser storage (`chrome.storage.session` when available, otherwise local), as do settings, snapshots, game library and match PGNs. The extension itself makes **no remote fetch or telemetry request**. In Auto mode it types into your own AI chat; in Manual mode you paste the prompt there yourself. That chat provider's privacy policy applies.

The extension's own code remains **MIT** ([LICENSE](LICENSE)). **Stockfish.js 17.1 Lite** in `engine/stockfish/` is separately **GPL-3** ([GPL text](engine/stockfish/COPYING-GPL-3.0.txt)); its **exact corresponding Lite source is bundled** in [`stockfish.js-v17.1.0-lite-single-source.tar.gz`](engine/stockfish/stockfish.js-v17.1.0-lite-single-source.tar.gz); provenance, individual source hashes and observed UCI options are in [SOURCE.md](engine/stockfish/SOURCE.md). The engine runs locally without network access, and its number is on the **Stockfish UCI_Elo scale, not FIDE**. Redistributors must comply with the Stockfish GPL obligations.

Questions: [FAQ](docs/FAQ.md) · [Support](SUPPORT.md) · [Changelog](CHANGELOG.md)
