# Architecture

AI Chess Companion is a zero-build Manifest V3 extension. The repository _is_ the extension: no bundler, no
transpiler, no runtime dependencies. Node is used only for tests and tooling.

## Layers

```
src/core        pure chess rules — no DOM, no chrome.*, runs in Node and in the browser
src/shared      platform registry, message contract, prompts, settings, storage, logging
src/background  service worker: side-panel behaviour, toolbar badge, active-tab tracking
src/content     AI page integration: bootstrap -> bridge (composer) + observer (transcript)
src/ui          side panel: session model -> render models -> DOM views
```

Dependency direction is strictly one way: `ui`/`content`/`background` → `shared` → `core`.
ESLint enforces the boundary with `no-restricted-globals` on `core`/`shared` (no `document`, no `window`, no `chrome`).

### Why a classic bootstrap for the content script?

Manifest V3 content scripts cannot be ES modules (`"type": "module"` is only valid for the service worker). The
standard workaround is used here:

```js
// src/content/index.js — the only classic script in the extension
const entry = chrome.runtime.getURL("src/content/main.js");
import(entry).then((module) => module.start());
```

Consequences that are easy to get wrong, and how they are handled:

| Consequence                                                                        | Mitigation                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Every module reachable from `main.js` must be listed in `web_accessible_resources` | `npm run check:manifest` walks the module graph and fails when a pattern is missing |
| A missing pattern fails silently at runtime (the extension loads, nothing happens) | The bootstrap logs a loud error, and CI blocks the manifest drift                   |
| A double injection would register listeners twice                                  | Both `index.js` (sync flag) and `main.js` (module flag) guard against it            |
| Import failures are asynchronous                                                   | `main.js` reports its state through `CONTENT_STATUS`, which the panel surfaces      |

## Chess core (`src/core`)

Squares are indices `0..63` (`a1 = 0`), pieces are FEN characters (`P`, `n`, ...). That keeps FEN, SAN and UCI
handling conversion-free.

| Module        | Responsibility                                                    |
| ------------- | ----------------------------------------------------------------- |
| `pieces.js`   | Colour/type helpers, Unicode glyphs, promotion choices            |
| `squares.js`  | Index ↔ algebraic conversion, light/dark squares                  |
| `attacks.js`  | Precomputed knight/king tables, ray tables, `isSquareAttacked`    |
| `move.js`     | Move record, flags, UCI codec                                     |
| `fen.js`      | FEN parse/format with strict validation (`FenError`)              |
| `position.js` | Move generation, legality, make/unmake, repetition keys, outcomes |
| `pgn.js`      | SAN rendering and PGN import/export                               |
| `index.js`    | The public surface of the core                                    |

**Move generation.** Candidate moves are generated from the board, then filtered by making the move and asking
"is my king attacked?". `makeMove`/`unmakeMove` are the same primitives the tests use for perft, so the fast path
(no cloning, no allocation per legality check) is also the tested path.

**Position keys.** Repetition uses `board | turn | castling | en-passant`, where the en-passant field is only
included when a capture is actually available — which is what FIDE requires for a repetition claim.

**Outcomes.** `outcome()` reports checkmate, stalemate, fifty-move, insufficient material and threefold repetition
with a PGN result token (`1-0`, `0-1`, `1/2-1/2`, `*`).

## Platform registry (`src/shared/platforms.js`)

The registry is the single source of truth for:

- the hostnames the extension may touch (`host_permissions`, `content_scripts.matches`, `web_accessible_resources.matches`),
- the composer/send-button/reply selectors per site,
- the display name used in the UI.

`manifest.json` is checked in (so the folder stays loadable) but its host lists are generated:

```bash
npm run sync:manifest    # rewrite the generated fields
npm run check:manifest   # CI: fail when the manifest and the registry disagree
```

## Content scripts (`src/content`)

**`bridge.js` — writing to the composer.** Finds the input by trying platform-specific selectors first and generic
ones afterwards, preferring the bottom-most editable element. Typing uses the React-proof native value setter for
`<textarea>`/`<input>` and `execCommand("insertText")` for contenteditable editors, followed by an `input` event.
Submitting prefers a send button and falls back to a full Enter key sequence. After submitting it waits for the
composer to clear, which is how every supported site acknowledges a sent message.

**`observer.js` — reading the reply.** A single `MutationObserver` on `document.body` nominates candidate message
containers. Because streaming answers mutate continuously, a scan is scheduled after 600 ms of quiet with a 2.5 s
upper bound. The newest container with a bracketed move wins. Guards:

- echoes of our own prompt are filtered (`isEchoOfPrompt`),
- nodes inside the composer or a user-message container are ignored,
- the same move is not reported twice inside 15 s,
- replies longer than 20 000 characters are not scanned.

## Side panel (`src/ui`)

```
GameSession (model)          BoardView / HistoryView / status line (views)
  position + history            describeBoard()      -> pure description of 64 cells
  turn ownership                describeHistory()    -> numbered rows
  undo / retry / snapshot       describeStatus()     -> text + tone + action
```

`app.js` owns the phase machine and is the only module that touches the DOM and `chrome.*` at once:

```
idle ──human move──▶ sending ──accepted──▶ awaiting ──AI reply──▶ idle
                       │                     │
                       └──error──▶ error     └──illegal reply──▶ retry (bounded)
```

Everything the views need is derived from the session, so a render is always a pure function of the state:
board, move list, status line, buttons and the FEN field are recomputed together.

**Persistence.** `chrome.storage.local` holds `settings` (validated on read) and `game` (a versioned snapshot:
starting FEN, player colour, UCI move list). A snapshot that cannot be replayed is discarded and a fresh game
starts, so a corrupt value can never wedge the panel.

## Service worker (`src/background`)

Deliberately small: panel behaviour (`openPanelOnActionClick`), a debounced tab tracker that updates the toolbar
badge and tells the panel which tab to use, and the `GET_ACTIVE_TAB` responder. Listeners are registered
synchronously so no event is missed when the worker is restarted.

The side panel is enabled everywhere (the board is useful without a chat), while the content script only ever runs
on the supported AI hosts.

## Data flow

1. Player clicks a piece → `GameSession.legalTargets()` → `describeBoard()` marks destinations.
2. Player clicks a destination → `playHumanMove()` → prompt built by `buildMovePrompt()`.
3. `SEND_CHESS_PROMPT` → content bridge types and submits it in the active tab.
4. `MutationObserver` → `extractMoveCandidates()` → `AI_MOVE` message to the panel.
5. `GameSession.playFirstAvailable()` validates and applies the move; an illegal reply triggers `buildRetryPrompt()`.

## Security

- No `eval`, no `new Function`, no `innerHTML`, no `fetch` — asserted by `test/markup.test.js`.
- UCI is validated before use; all AI text is treated as untrusted input.
- Minimal permissions: `sidePanel`, `scripting`, `storage`; host permissions limited to the AI platforms.
- The packaged archive contains only `manifest.json`, `sidepanel.html`, `src/`, `icons/` and licence files.

## Extending

| Change          | Where                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| New AI platform | `src/shared/platforms.js`, then `npm run sync:manifest`                                            |
| New board theme | `src/ui/theme.css` (`[data-theme="..."]`) plus the option in `sidepanel.html`                      |
| New setting     | `src/shared/settings.js`, the dialog in `sidepanel.html`, and `#applySettingsToDialog` in `app.js` |
| New UI element  | `sidepanel.html` + the `byId` map in `src/ui/main.js` (a test fails if the id is missing)          |
| Engine feature  | `src/core/position.js` with a perft or unit test next to it                                        |
