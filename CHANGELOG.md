# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-09-26

Continuation work after v0.7.2 (PR #13): mode/invariant foundations, the Explain
setting, and battle-snapshot hardening.

### Added

- Authoritative `Mode` vocabulary (`PLAY` | `RATED` | `BATTLE` | `BOT_VS_AI`) with an explicit transition table and `deriveMode` from live App ownership (`src/ui/modes.js`).
- Pure, privacy-safe `checkInvariants(state)` for request/phase agreement, mode ownership, board/session sync, clock ownership, pause/terminal cleanup, and pending-side checks (`src/ui/invariants.js`). App exposes `inspectState()` for tests.
- **Explain** setting (`off` / `short` / **`full`**, default **`short`**) with a live-only collapsible thinking card. `extractCommentary` strips prompt echoes, move tokens, code fences, and markdown; commentary never enters storage, PGN, timeline, diagnostics, or logs.
- Short-explain prompt line (standard/concise only; Efficient stays move-only). `opponentIsEngine` prompt wording and a `Move N (ply P)` line when ply count is known.
- Battle snapshot validation: malformed or future-version snapshots are discarded safely on restore.

### Fixed

- **Removed move tokens no longer leave broken prose.** `"I play [e7e5]. This opens the centre…"` used to display as `"I play . This opens the centre…"`; the extractor now repairs orphaned punctuation/dashes and drops an empty leading shell ("I play.", "I choose to."). Cosmetic only — parsing is untouched.
- **Explain → Off drops the retained commentary** instead of only hiding the card, so no explanation text is held in memory (or re-shown by `inspectState()`) after the user turns Explain off.

### Testing

- New `test/modes-invariants.test.js` and `test/explain.test.js` (extraction, residue repair, prompt variants, storage privacy, thinking-card DOM, settings persistence); App-level battle restore cases (malformed discarded **and** removed from storage; well-formed still restores); i18n/locale parity for Explain keys. Suite 321 → 340 green.

## [0.7.2] - 2026-09-25

### Fixed

- **"The AI answered, but the board didn't move."** Root cause (H1, proven red-first): after a send whose delivery could not be confirmed, v0.7.1 parked the AI's reply until a matching user echo was recognised — but the echo check pre-filtered new user nodes through `newUserMessages`, which keeps a node only if it is a known user-side element **or** its text equals the prompt *exactly*. ChatGPT's outer turn article ("You said: …"), Grok's `.items-end .message-bubble` and reflowed Perplexity echoes were discarded before the lenient `isEchoOfPrompt` ever ran, so the gate never opened and the reply sat in `queuedReply` forever. The observer now judges **every** new user node with `isEchoOfPrompt`, and a new pure `ReplyGate` (`src/content/reply-gate.js`) attributes a reply as soon as it is safely attributable — the matching echo **or** the reply in its own new post-submit assistant container. A parked reply can no longer be stranded, and **no second submit is ever issued**.
- **Pre-created or re-used assistant bubbles (H2).** A container that was empty at the submit baseline (a host pre-rendering the next turn) or whose content was fully replaced (a re-used node) is now scanned when the move arrives. An old reply that is merely re-rendered is still never replayed.
- **Streaming past `MAX_WAIT_MS`.** The max-wait scan used to issue a premature "no move" for a still-streaming plan-like reply, which stopped the watcher and lost the real move that followed. Max-wait now only reports moves; no-move needs settled text and a finished generation, and the bare-UCI fallback is used only for stable text (a half-streamed `[e7e8` is never read as `e7e8`).
- **Quoted prompt before the answer (H3).** A container that repeats the whole prompt verbatim (turn wrappers, or an AI quoting the request) has that copy stripped before parsing (`stripPromptEcho`), so the answer after it is read; the echo itself, partial quotes, legal lists and history still never become moves.
- **No silent stall on a move-less reply.** A settled, finished reply with no parseable move (e.g. "Ready when you are!") now yields the honest no-move state (bounded corrective retry, then **Ask again**) instead of being ignored because it was short or lacked "plan" keywords. Never a substituted move.
- **Truthful idle status.** "Waiting for {platform} to answer…" is shown only while a request is really pending. When the AI is to move but nothing was sent (a fresh board with the AI as White, a reopened panel), the new `status.aiToMove` copy (en + vi) says so and offers **Ask AI**. A pinned-tab reply that no live request owns is never applied and is surfaced as "arrived too late and was ignored" instead of vanishing.
- Manual-mode diagnostics are reset per request so the reply stages of one move are never attributed to the previous one.

### Changed

- **Prompt + context engineering (additive only).** Every prompt variant now carries an explicit `Side to move: X.` line and asks the AI to show its move in the visible chat reply as plain text, not in a code block. The opening prompt (the AI moves first) asks for the first move **now** — a protocol-only opener invited "Ready when you are!" and stalled the game. Concise/Efficient spell out the promotion shape `[e7e8q]`; the corrective retry prompt carries the visibility line too. The fun commentary instruction is condensed into one line with the same contract. Nothing decision-relevant was removed (FEN, history, last move, legal and rejected sets, battle clock); the reply grammar is unchanged; Prompt Studio stays byte-identical.
- Diagnostics report: privacy-safe **reply-path** codes — attribution (`confirmed` / `echo` / `reply` / `manual`), outcome (`move` / `no-move` / `repeated` / `resigned`), skipped-echo count, refilled-container flag. `reply-detected` is now recorded for every verdict, so "answered but didn't move" is diagnosable from stages + delivery state alone.

### Testing

- New `test/observer-reply.test.js` (content layer, 13 tests incl. end-to-end through the real content entry) and `test/reply-apply.test.js` (panel layer, 6 tests), plus 4 prompt tests in `test/prompt-modes.test.js`. Red-first: 10 content + 2 panel + 3 prompt tests failed on v0.7.1 for the diagnosed reasons. Full suite 321/321 (baseline 298); `npm run verify` and `dev:smoke` green. No new wall-clock assertions.

## [0.7.1] - 2026-09-25

### Fixed

- **No more false "Could not submit the prompt. Send it manually to continue." when the send actually worked.** The bridge's post-submit confirmation detected "our echo" with a strict whitespace-collapsed **exact** match, while the reply observer's echo gate already used the lenient `isEchoOfPrompt` (prompt-shaped or shared prefix). Real chess prompts are prompt-shaped, but chat hosts routinely reflow the echoed user message (append an annotation, wrap or re-space nodes). The strict match then failed, the single new user message was misread as a *different* message ("contradicted"), and a **working** send — composer cleared, echo present, the AI already starting to answer — was reported as a hard failure with a "copy it and send it yourself" recovery. `#confirmed()` now recognises the echo exactly the way the observer does, so a reflowed echo is **confirmed**, not contradicted. The fail-closed guarantee is unchanged: a genuinely different new user message (and two-or-more new messages) still fail closed as `submit-failed`.
- **Distinct, honest copy for a send that was never dispatched.** All submit verdicts previously collapsed into the one generic `status.submitFailed` string. "Nothing was submitted — the page accepted no send action" is now its own verdict (`SendResult.SUBMIT_NOT_DISPATCHED` / `submit-not-dispatched`) with its own English + Vietnamese copy (`status.submitNotDispatched`) and the Copy recovery that matches a provably-unsent prompt. `status.submitFailed` now surfaces only for a genuine contradiction (a different new message proved the prompt never reached the transcript), and a dispatched-but-unconfirmed send still shows the "check the pinned chat" copy and never auto-resends.

### Testing

- New `test/submit-truthfulness.test.js`: red-first regressions at both layers — the content bridge (reflowed echo ⇒ confirmed; unrelated message ⇒ still contradicted; slow echo ⇒ unconfirmed) and the panel (a pending/unconfirmed send never shows `status.submitFailed`, never auto-resends, and still resolves on the reply; `submit-not-dispatched` shows its own copy with Copy recovery; a contradiction still shows `submit-failed`). Full suite 298/298; `npm run verify` and `dev:smoke` green.

## [0.7.0] - 2026-09-25

### Added

- **AI Battle (unrated): two pinned AI tabs play a full clocked game.** A battle-only **opponent pin slot** reuses the existing pin machinery (the MAIN pin invariant is untouched; no new permissions or hosts) and lives only for the duration of a battle. **GameSession owns the battle game** exactly like a normal game and the local engine **never** plays a battle move — both sides' plies arrive strictly from their own tab (tab + request id per side) and pass the existing echo/history/legality protections. One submit per tab per turn; illegal or missing replies get bounded per-side retries (`maxRetries`) and then **PAUSE** with **Ask again / Abort / Export** — a move is never substituted or fabricated. Delivery failure (unconfirmed, contradicted or unreachable) **PAUSES** with per-side "what happened?" detail and user-driven recovery only — no auto-resend, no hidden retry. Battles require **Auto** send mode and offer the switch as an explicit action. Epochs bump on pause/unpin/abort/new-battle/flag so stale callbacks can never mutate a battle. Results: checkmate, resignation (the AI's own resign action), flag, draw, **adjudicated draw at max plies** (default 200, bounded), or aborted-unfinished (no ledger entry). Flag fall is a loss immediately, even mid-send. Final clock times persist with the result. A **W–D–L ledger per ordered tab-pair** and a Battles history list sit behind the secondary view, with one-click **rematch** (same slots) and **paired PGN export** (both perspectives, both tabs named) plus export-all. Battles are **UNRATED** — rated match records are never touched. Battle snapshots restore **PAUSED** with Resume — loading never auto-continues a send.
- **Chess clock for each AI in its prompt.** Every battle prompt carries "You have {mm:ss} left; your increment is {n}s." (default 5+0; 1–60 min, increments 0/2/3/5 s; increment lands on move completion). Concision never strips the cue; the Prompt Studio shows it when a battle preview is selected.
- **Latency Timeline (measure-first)** under Diagnostics: every accepted move records stage timestamps (queued, dispatched, submitted, echo-observed, reply-detected, parsed, accepted, rendered) as **ms deltas** in a ~20-move ring buffer with copy-redact export and `dev:smoke` stage breakdown. It **never** stores message text, FENs or titles; CI asserts only stage presence, ordering and non-negative finite numbers.
- **Prompt Studio.** A progressive-disclosure panel shows the **exact** prompt the send path dispatches (byte-for-byte from the shared builder), the platform label, a standard/concise preview toggle, live character/line counts with a >800-character budget warning, and Copy — all local, zero network.
- **Efficient and Fun response styles** (plus the clearer standard/concise prompts). Efficient asks for the chosen move only in the existing UCI-in-brackets format with no commentary. Fun appends 1–2 witty sentences (slider-controlled length) **after** the move and outside square brackets so commentary can never interfere with move parsing or chess logic. All styles share the same game state and move-selection logic; only the output contract differs. Settings: response style, fun-commentary length, battle minutes/increment/max-plies — all validated, old storage preserved.

### Changed

- **Lower reply latency with quality preserved.** The new timeline exposed the old fixed waits (total ≈ +359 ms per move). Adaptive fast-start polling with exponential backoff (40 → 80 → 160 ms capped) plus early exits on real evidence (Stop seen, echo observed, composer cleared — never before the contradiction/fail-closed check) brings a typical reply to ≈ +48 ms of panel-side waiting — about **7.5× faster** — with the same one-submit, readback and echo protections and the same reply contract.
- The prompt builder is a single source of truth (`src/shared/prompt.js`) with clearer instruction ordering. Standard prompts add one legality reminder line; decision-relevant context (full FEN, history, last move) is never removed and the reply grammar is unchanged.

## [0.6.0] - 2026-09-24

### Fixed

- **No more false "Could not submit the prompt" at checkmate.** The five-layer P0 fix separates _never attempted_ from _attempted but unconfirmed_: the bridge records every send attempt (`SUBMIT_UNCONFIRMED`), the content script keeps the watcher alive and waits for the user-echo gate instead of discarding a fast reply, and the panel guards late failures/ack/timeouts against terminal positions (`expectedReplyId` + `isGameOver` + reply-epoch). Status descriptions now prefer the board outcome over stale delivery errors, so a finished game stays finished; `status.submitFailed` appears only when nothing was ever dispatched (or a **different** new user message proves the prompt never reached the transcript). An ambiguous send instructs **Check the pinned chat** — never an automatic resend — and a confirmed-sent prompt shows "Waiting for … to answer". Copy/Ask recovery is hidden the moment a result is accepted.
- Late `CONTENT_STATUS`/`SEND_CHESS_PROMPT` failures, stale asks, and delayed diagnostics can no longer overwrite a checkmate/stalemate/draw result or re-prompt after a human checkmate. Pause, unpin, new game, undo, side switch and Stop all invalidate outstanding callbacks (reply-epoch bump).

### Added

- **Compact Play-first view** with progressive disclosure: header + one **More** menu (Settings, Help), board, context-driven status card with a single primary action, pinned-chat chip with **Change**, side line + New game, compact move preview with the full history collapsed, and Tools/Library/Analysis/Position/Diagnostics behind expandables. Dismissible first-run note; "What happened?" delivery disclosure (never-attempted / unconfirmed / confirmed-awaiting / stale) with technical detail kept privacy-safe.
- **Help section** (More → Help) that distinguishes the pinned chat, local Hint/Analyse tools, and rated matches.
- **Rated banner** showing which side the chat AI and Stockfish play (UCI_Elo anchor) while a rated match is active.
- **Six new local settings** (validated in `src/shared/settings.js`, defaults preserve old storage): interface detail Simple/Advanced (default Simple — only technical sections hide), board orientation follow-side/white/black (default follow-side), move-list display SAN/UCI (default SAN; PGN stays SAN), move interaction tap-drag/tap-only/drag-only (default tap-drag; keyboard unchanged), destructive-action confirmation (default on; rated starts always confirm), and a bounded "still waiting" reminder Off/30s/60s/2m (default Off — it never resends, never changes the result).
- Regression tests A–F for the delivery/checkmate race (`test/status.test.js`), bridge contradiction fail-closed behavior, and settings defaults/corrupt/persistence/reset/locale coverage (`test/settings.test.js`); updated markup tests for the compact view.

## [0.5.0] - 2026-09-24

### Fixed

- One move now sends **at most one** chat message across all six supported platforms. The bridge waits for Stop/streaming to end, verifies the full prompt, and never clicks Stop or follows a successful button click with Enter/`requestSubmit`. Ambiguous sends and timeouts offer a copy instead of an automatic keystroke retry.
- Illegal AI moves now explain the rule (pins, castling, en passant, promotions, etc.); bounded retry prompts include the legal set in safe `e2-e4` notation and the previously rejected moves. Echoed requests and historical assistant containers cannot become moves. Maximum retries end in error with **Ask again**, without a local engine substituting an AI move.
- Out-of-turn source-piece moves are rejected by `Position.legalMovesFrom`; perft and existing chess rules remain exact. Move sounds now classify captures by SAN/flags instead of looking for `x` in UCI.

### Added

- One explicitly **pinned AI tab** (session storage; local fallback) with a supported-tab picker showing content-script titles and hosts. Focus cannot retarget prompts; tab closure or off-host navigation clears the pin with a visible explanation. White/Black toolbar switch starts a new game, with confirmation if moves exist.
- Persisted soft Pause/Resume disconnects the transcript observer and stops workers, leaving the content script injected but idle, with `OFF` badge. Manual send mode copies instead of typing/clicking; generation wait is configurable (default 120 seconds).
- Settings grouped as Board, Sound, Clock, AI and Engine. Adjustable clock duration, off-by-default synthesized wood knocks with volume, and 180ms piece/capture/castle/promotion animations respecting reduced motion.
- A **real rated match** versus the packaged, single-threaded Stockfish.js **17.1 Lite NNUE WASM** worker. The worker uses its own reported UCI_Elo min/max, `UCI_LimitStrength` and `go movetime`; it never plays the chat AI's turn. Only finished chess results/parsed resignations count. Per-anchor local records/export, AI-colour alternation, n/W–D–L, bounded MLE and 95% profile-likelihood interval (provisional when small/wide). Label: **Stockfish UCI_Elo scale, not FIDE**. Heuristic levels 1–8 remain unrated.
- Tests for full-string readback, six-host Stop protection, one-submit behavior, retry echoes/reasons, pinned tab and pause, real-game match plumbing, draw-aware estimator and UCI range clamp. No runtime npm dependency, remote engine download, new permission or second rules engine.

### Licensing

- Extension UCI controller/UI remains MIT. The **vendored Stockfish.js component is GPL-3**; unchanged copyright/author notices, GPL text and exact upstream source are in `engine/stockfish/`. The exact corresponding Lite source is **bundled** as `engine/stockfish/stockfish.js-v17.1.0-lite-single-source.tar.gz` from commit `f9512ef9aff391026813a56855dd086cb72a2d58`; published archive: **https://registry.npmjs.org/stockfish/-/stockfish-17.1.0.tgz**. See `engine/stockfish/SOURCE.md` for hashes and UCI verification.

## [0.2.2] - 2026-09-24

### Fixed

- **Uneven board squares**: `.board` only pinned the 8 columns, so the implicit `auto` rows grew
  with piece glyphs — ranks holding pieces rendered taller than empty ranks (and the grid could
  overflow its aspect box). The grid now pins `grid-template-rows: repeat(8, minmax(0, 1fr))`, and
  empty `.piece` spans reserve the same line box as occupied ones via a hidden `::before`.
- **Panel nudged down on left-click**: every square click re-rendered the move list, which called
  `scrollIntoView({ block: "nearest" })` unconditionally — scrolling the whole side-panel document
  whenever the moves sat below the fold. The list now auto-scrolls only when the moves/cursor
  actually change, and moves just its own container (`scrollTop`), never the page.
- **Tap/drag double handling**: `pointerup` handled taps/drags and the trailing compatibility
  `click` then fired `onSelect` again — a tap selected and instantly deselected a piece, and a
  drag reselected its origin. The pointer gesture now claims the following `click`
  (keyboard/assistive-tech clicks without pointer events still work).

### Added

- Regression tests: `test/board-interaction.test.js` (tap-once, drag-once, empty-square click
  path, pointer-less click, scoped move-list scrolling) plus markup guards for the 8-row grid and
  the `scrollIntoView` ban in `history.js`.

## [0.2.1] - 2026-09-24

### Fixed

- **Black screen (critical)**: sidepanel had inline <script> blocked by MV3 CSP (script-src 'self'), leaving body.theme-loading {visibility:hidden} permanently. Fixed by:
  - Moving theme flash logic to external `src/ui/theme-init.js` (CSP-safe, no inline)
  - Removing inline scripts from sidepanel.html (0 inline, 2 external: theme-init.js + main.js)
  - Changing theme.css: theme-loading no longer hides body (opacity:1) with safety timeout
  - Adding defensive `forceVisible()` in main.js (error/rejection handlers, DOMContentLoaded, 1.5s timeout)
  - Hardening App.start() with try/catch around settings/library/snapshot/render/connection, corrupt snapshot auto-reset, and final unhide in finally
  - App.applyTheme() now also removes theme-loading and clears document background
  - Bootstrap try/catch shows error in status instead of blank screen

### Changed

- sidepanel.html: CSP-compliant, no inline scripts
- theme-init.js: new early loader, handles system theme, caches boardTheme/fontScale/density, safety net 1s unhide
- main.js: resilient bootstrap, status error display on failure
- app.js: robust start() with granular try/catch, never throws to cause black screen
- markup.test.js: updated to assert 0 inline scripts, theme-loading not visibility:hidden, theme-init.js exists and CSP-safe

### Security

- No new permissions, still no remote fetches, no innerHTML


## [0.2.0] - 2026-09-23

### Added

- **Board interaction v2**: pointer-events drag & drop with ghost piece, hover preview, 180ms animation respecting `prefers-reduced-motion`, flip, coordinates toggle, hint arrow SVG, WebAudio sounds off by default, copy/paste FEN with validation, copy position (FEN+PGN)
- **Game library**: `chrome.storage.local` LRU 50 with quota-aware fallback, list/open/rename/duplicate/delete with undo (10s), import/export PGN file/clipboard/textarea, search, autosave debounced, schema v2 migration (finalFen, currentPly) tested, corrupt prefix kept
- **i18n en/vi**: ESM dictionaries `src/shared/i18n.js` with `t()` interpolation/pluralisation, `chrome.i18n.getUILanguage()` live switch via settings, `_locales/` JSON, test fails on divergence or bypass
- **Themes v2**: light/dark/system with no flash (inline head script reads `localStorage ai-chess-companion-theme-cache`), board themes classic/blue/green/high-contrast AAA, font scale small/medium/large, density comfortable/compact persisted, shortcuts via `chrome.commands` and `?` help dialog
- **AI-host bridge v2**: platform registry ordered candidates per role with strategy, typing that verifies read-back, submit with confirmation and no double, response extraction handling figurine unicode/0-0/e8=Q+/annotations, streaming settle 800ms + periodic scan, plan reply detection with stricter retry bounded backoff 500ms/1s/2s, recovery bounded, degraded clipboard fallback (copy prompt button), diagnostics section (platform, matched selectors, timings, copy report)
- **Local engine**: iterative deepening alpha-beta quiescence Zobrist TT 256k MVV-LVA killer/history, Worker cancellable (`search-worker.js` protocol search/info/result/cancelled/error/ready), Hint arrow, eval bar (white perspective %), classification blunder/mistake/inaccuracy/good/brilliant (heuristic labelled), analyse game accuracy report (white/black % + biggest swings), play vs engine levels 1-8 (depth 1-7, deliberate weakness low levels)
- **Clock**: optional white/black clocks with start/stop/tick 250ms, format mm:ss, flag detection
- **Diagnostics UI**: section with platform/composer/send/assistant/timings/error/report/copy/toggle details
- **Eval bar & analysis UI**: eval-bar, accuracy bars, move classification colors
- **Library UI**: search, import/export/new, actions open/rename/duplicate/delete/export
- **FEN & shortcuts dialogs**: paste FEN with status, help dialog with keyboard shortcuts
- **A11y v2**: focus trap/restore in dialogs, promotion keyboard/Escape, move list auto-scroll to current/replay cursor, announcements live region, status line actionable (RELOAD_TAB, COPY_PROMPT, UNDO_DELETE), badge+title turn/check sync (W/B/!/AI colors), no color-only, axe-core 0 violations both themes/locales
- **Narrow viewport**: 280-900px overflow fixes, long PGN/FEN wrapping, responsive grid

### Changed

- Snapshot version 2 with finalFen/currentPly, migration v1→v2, corrupt handling keeps valid prefix
- History view with replay viewer jumpToPly/goToStart/goToEnd/goBack/goForward, currentPly, active ply highlighting, comment/classification display
- Status model with RELOAD_TAB/COPY_PROMPT/UNDO_DELETE actions, diagnostics-aware, i18n tr param
- Board view with drag & drop, hover, ghost, hint arrow, animation
- Theme.css v2 with board themes, eval/library/diagnostics/clock styles, narrow fixes
- Background panel with badge turn/check sync (W white blue, B black dark, ! check red, AI default green) and GAME_STATE_CHANGED handling

### Fixed

- P0 theme flash before paint fixed via inline head script and localStorage cache
- First-run dead end: status offers OPEN_AI action, platform banner hint, copy prompt fallback
- Board drag & drop, hover, check highlighting, touch via pointer events
- Promotion keyboard/Escape/focus restore
- Move list auto-scroll to replay cursor
- Focus/dialogs trap/restore
- Dark mode contrast AAA for high-contrast board theme
- Async double-fire guard (busy flag) and rollback
- Destructive undo with 10s undo
- Empty/error states designed for library, moves, diagnostics
- Long content wrapping for PGN/FEN
- Status line actionable with degraded clipboard fallback
- Badge+title turn/check sync

### Security

- No innerHTML/eval/new Function/document.write/inline handlers; all rendering via textContent
- Treat AI output/PGN/clipboard/storage as untrusted, sanitised
- No new permissions (allow_commands only), no network beyond user's typing into AI page

## [0.1.0] - 2026-09-23

First public release. A ground-up rewrite of the initial prototype: the chess engine, the AI bridge and the side
panel were separated into layers, the manifest is generated from a single platform registry, and the whole
repository is covered by automated tests.

### Added

- **Modular architecture** (`src/core`, `src/shared`, `src/background`, `src/content`, `src/ui`):
  - `src/core` is a dependency-free chess engine that runs unchanged in Node and in the browser
  - `src/shared/platforms.js` is the single source of truth for the supported AI hosts and their selectors
- **Complete chess rules**: legal move generation with pin/check filtering, castling (including the "through check"
  rule), en passant, promotion, checkmate, stalemate, the fifty-move rule, threefold repetition and insufficient
  material, each reported with its PGN result token
- **Sanity-checked engine**: `perft` node counts for six reference positions and a replay of Morphy's Opera Game
  in Standard Algebraic Notation
- **PGN support**: export the current game (with headers and the final result) and import a PGN back onto the board,
  tolerating comments, variations, NAGs and `0-0`-style castling
- **Side panel features**: promotion chooser, move list, undo of a full move pair, board flip, dark and light
  themes, keyboard-navigable board, FEN display and copy
- **Play as Black**: the panel flips the board and asks the AI for the opening move
- **Automatic recovery**: an illegal AI reply triggers a bounded, configurable retry with the position restated
- **Game persistence**: the running game is restored after the panel is reopened, with unmatched or corrupt
  snapshots discarded safely
- **Connection awareness**: the toolbar badge marks supported AI tabs, and the status line explains what to do when
  no AI chat is open, offers the action inline, and shows which platform is connected
- **Tooling**: `npm test` (140+ tests via `node:test`), ESLint flat config with layer boundaries, Prettier,
  `npm run check:manifest` (validates hosts, permissions and the dynamically imported module graph),
  `npm run dev:smoke`, and a CI workflow that lints, tests and packages a store archive artifact
- **Docs**: rewritten README, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/FAQ.md`, `docs/STORE_LISTING.md`
- **Icons**: 16/48/128 px artwork wired into `manifest.json`

### Changed

- Content scripts are now ES modules loaded through a classic bootstrap with `web_accessible_resources`; CI fails
  when a pattern is missing so the import can never break silently
- The side panel is available on every page (the board works standalone); the content script still only runs on the
  supported AI hosts
- Permissions are minimal: `sidePanel`, `scripting`, `storage` — `activeTab` and the redundant `tabs` permission are
  no longer requested
- Settings and the running game are stored in `chrome.storage.local` instead of living only in memory
- UI re-renders update existing board cells instead of rebuilding the grid, preserving focus and hover state

### Fixed

- Pawn capture generation compared piece symbols instead of colours, which allowed captures on friendly pieces and
  rejected legal ones — caught by `perft`, now covered by regression tests
- Castling geometry is derived from the board orientation instead of string arithmetic
- Undo history is a proper stack, so `makeMove`/`unmakeMove` restore the position bit-for-bit
- A move that leaves the mover in check is rejected consistently for every piece type
- The side panel no longer sends a prompt when no supported AI tab is active; it explains the situation instead
- Duplicate AI replies are suppressed per move *and* per message container, so repeated DOM mutations cannot replay
  the same move

### Security

- Removed `activeTab` and `tabs` from the permission list
- The manifest, the module graph and the absence of `eval`, `fetch` and `innerHTML` are all asserted by automated
  checks
- No runtime dependencies; the packaged archive contains only what the browser needs

[0.1.0]: https://github.com/coderunknow/Chess-With-AI/releases/tag/v0.1.0
