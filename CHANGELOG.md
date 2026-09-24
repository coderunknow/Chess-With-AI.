# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
