# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
