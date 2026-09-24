# Chrome Web Store Listing — AI Chess Companion v0.6.0

## Short name

AI Chess Companion

## Summary (132 characters max)

Play chess with six AI chats in Chrome's side panel. Pin one tab, validate moves, or run a local Stockfish Elo match.

## Description

**Play chess with your own AI chat — on a real board beside the conversation.**

Pin **one** supported tab: Gemini, ChatGPT, Claude, Grok, Perplexity or Copilot. Play White or start a new game as Black. Your legal move, FEN and history go only to that pinned chat; focus changes do not redirect it. The reply is checked by a complete local rules engine, and illegal AI moves get a clear reason and a bounded correction. No AI account, extension API key, remote chess service, analytics or telemetry.

### Features

- Responsive board, promotion chooser, PGN import/export, local library, optional clocks and off-by-default synthesized wood sounds.
- Automatic send **waits for the model to finish**; it never clicks Stop or presses Enter after clicking Send. If the full prompt cannot be verified, use Copy prompt instead. **Manual** mode copies the prompt so you can paste and send it yourself.
- **Pause / Resume** disconnects the transcript observer, stops local workers and shows `OFF` on the toolbar. It persists; closing the panel alone does not auto-pause.
- Hint / Analyse / local Play vs engine use a heuristic strength control **1–8**, **not Elo**.
- Optional **rated Stockfish match**: a packaged, single-threaded Stockfish.js **17.1 Lite NNUE WASM** plays actual moves against the chat AI in the pinned tab. Requires Auto mode and a live pin. Completed chess results, not protocol errors or unfinished games, update a local maximum-likelihood estimate. See **games, W–D–L, point estimate and 95% interval**, marked provisional when evidence is weak. **Stockfish UCI_Elo scale, not FIDE**, and not a website rating. The engine's reported UCI_Elo bounds control the anchor; no depth-to-Elo conversion.
- English/Vietnamese, light/dark/system UI, classic/blue/green/high-contrast board, reduced-motion-aware piece animation.

### How to use

1. Open a supported AI chat, open the panel, and **pin** its tab in **AI chat connections**.
2. Move a piece. The request is sent at most once, and only a _new_ assistant reply can become a move.
3. Set **AI → Send mode: Manual** if you prefer to paste the copied prompt yourself.
4. To measure the chat model against Stockfish, use **Settings → Engine → Start rated game** once Stockfish is ready. This confirms and starts a new game. Export completed match PGNs whenever you like.

### Privacy and permissions

The extension's own code makes no remote fetch, socket, telemetry or rating-server request. The only off-device chess data is the message you submit to **your own AI chat**; that provider's privacy policy applies. The supported-tab picker reads titles via content scripts; the chosen tab URL/title and settings, games and match PGNs stay in local/session browser storage. Host access is limited to the eight declared hostnames of six services. `sidePanel` displays the UI, `storage` saves on-device state, `scripting` injects the packaged content script when needed. No `tabs`, `management` or general browsing-history permission.

### Open source and licenses

Extension code is **MIT** ([LICENSE](../LICENSE)). The separate vendored **Stockfish.js 17.1 Lite WASM** is **GPL-3**, local and network-free; GPL text, authors, the **bundled corresponding Lite source**, exact upstream revision and checksums ship in [`engine/stockfish/`](../engine/stockfish/SOURCE.md). No runtime npm dependencies, CDN or remote executable code.

## Category / languages / assets

Games / Fun. English and Vietnamese. Icons: 16/48/128px in `icons/`.

Screenshots to prepare: (1) board and visibly pinned tab, (2) manual/Stop-wait status, (3) translated illegal-move explanation, (4) Stockfish match with n/W–D–L/interval/non-FIDE label, (5) Pause `OFF` badge. 1280×800 or 640×400.

## Privacy tab answers

**Single purpose:** Play legal chess with a selected AI chat in the side panel and optionally estimate the chat model against packaged strength-limited Stockfish.

**Data usage:** No analytics, telemetry, backend, remote executable code or rating server. Prompts entered in the user's AI chat are subject to that chat's terms. On-device storage may contain chat titles/URLs, PGNs, and settings.

**Host permissions:** Only to list the supported AI tabs and run the packaged content bridge in the user's chosen chat. No `<all_urls>`.

## Before store submission

- [ ] Manual browser checklist on **all six** supported hosts (`docs/DEVELOPMENT.md`); automated DOM doubles do not certify live site layouts.
- [ ] Create screenshots and host the privacy policy.
- [ ] Run `npm run verify && npm run package`; upload `build/ai-chess-companion-0.6.0.zip` with its GPL-3 engine notice.
