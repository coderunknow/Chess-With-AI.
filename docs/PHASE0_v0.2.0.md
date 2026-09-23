# Phase 0 — AI Chess Companion v0.2.0 Audit & Plan

Date: 2026-09-23
Baseline: v0.1.0, 164 tests passing, `npm run verify` green (checked locally)
Branch: `arena/01a0cea4-chess-with-ai`

This document is the required Phase 0 deliverable: UI defect audit, integration risk list, phased plan with acceptance criteria, and evidence plan. No code changes yet.

---

## 1. How the audit was performed

- Read in order: README, ARCHITECTURE, DEVELOPMENT, PRIVACY, CHANGELOG, manifest, src/core, src/shared, src/background, src/content, src/ui, test/, scripts/, sidepanel.html, eslint.config.js.
- Ran `npm test` → 164 pass, perft verified (6 positions) in test suite.
- Statically traced every `src/ui` render path, every `src/content` selector, every `chrome.*` usage.
- Checked theme.css against 280px and 900px panel widths by inspecting grid, flex, clamp, overflow-wrap, dialog sizing.
- Checked accessibility: role attributes, aria-labels, focus-visible, keyboard handlers in BoardView, dialog usage.
- Checked MV3 correctness: classic bootstrap + dynamic import, web_accessible_resources coverage via `npm run check:manifest` (green).

No browser was launched in this sandbox for Phase 0. Defects marked “confirmed via code” are observable without a browser; those marked “needs manual” will be verified with a real panel in Phase A.

---

## 2. UI Defect Audit

| ID     | Screen                                       | Steps to reproduce                                                                              | Expected                                                                                                                                           | Actual (v0.1.0)                                                                                                                                                                                                                                                                                                                                       | Severity | Root cause                                                                                                                                 | Fix                                                                                                                                                                                                                                                                                                                                                     | Regression test                                                                                                           |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| UI-001 | Side panel, any AI tab opened before install | Install/load unpacked while chatgpt.com tab already open, open side panel, play e2e4            | Panel detects content script missing, shows “Reload the tab to connect” with button                                                                | Generic “Could not reach the AI tab: …” or silent no-op; injection attempted but failure not actionable                                                                                                                                                                                                                                               | P0       | `App#ensureContentScript` does ping→inject but UI does not surface “reload” action; no `CONTENT_STATUS` for input-missing in initial state | Detect missing content script on `PING` failure, store diagnostic, status line shows “Content script not found — Reload the tab” with action that calls `chrome.tabs.reload(tabId)`. Add diagnostics section.                                                                                                                                           | Unit: fake-chrome with failing sendMessage → status action = RELOAD_TAB. E2E: panel against blank page.                   |
| UI-002 | Side panel at 280px and 900px                | Resize side panel to ~280px, then drag to 900px, inspect board, controls, FEN, history, dialogs | No horizontal scrollbar, board scales, controls wrap, FEN wraps, dialogs fit                                                                       | Board scales via grid, but `.row` containing `<select width:100%>` + button may overflow; dialog width `min(94vw,420px)` may exceed 280px panel (vw is viewport, not panel, but still large); `.fen` wraps but `select` may push button off                                                                                                           | P1       | `theme.css` missing flex:1 on select, no max-width containment for dialogs, no container query                                             | Add `min-width:0` on flex children, `flex:1` on selects, `max-width:100%` on dialogs, test at 280/400/900 via Playwright screenshot. Add CSS `overflow-x:hidden` on panel, `box-sizing` already.                                                                                                                                                        | Playwright: open sidepanel.html at 280,400,900 widths, assert `scrollWidth <= clientWidth`, screenshot diff.              |
| UI-003 | Board interaction                            | Try drag piece from e2 to e4, hover over piece, touch drag, pen                                 | Drag & drop with pointer events, hover preview of legal moves, touch/pen works, click-click still works                                            | Only click handler (`click` event) in BoardView; no pointerdown/move/up, no hover preview, no drag ghost                                                                                                                                                                                                                                              | P0       | BoardView only listens to `click` and `keydown`; no pointer events                                                                         | Implement pointer events: `pointerdown` starts drag, `pointermove` tracks, `pointerup` drops; create ghost piece; hover: on `pointerenter` show targets if `showLegalTargets`. Keep click-click. Use `setPointerCapture`. Respect `prefers-reduced-motion` for animation.                                                                               | Unit: describeBoard still pure; new BoardView tests with fake-dom simulating pointer events. E2E: drag e2→e4 moves piece. |
| UI-004 | Promotion dialog                             | Play e7e8 with pawn, try keyboard: Tab, Escape, Enter, focus return                             | Dialog opens, initial focus on queen, Tab cycles 4 pieces + Cancel, Escape cancels and returns focus to board, choice obvious with glyph + label   | Dialog opens via `showModal()` but no initial focus set; focus return not implemented; Cancel button works but focus lost after close; promotion choice visible but no aria description of which color                                                                                                                                                | P1       | `#askPromotionPiece` sets glyphs but never focuses; no `previouslyFocused` restore                                                         | Store activeElement before showModal, focus queen button, trap via native dialog, on close restore focus to board square. Add `aria-label` already present, add visible text label under glyph. Test keyboard flow.                                                                                                                                     | Unit: fake-dom dialog open/close focus tracking. E2E: keyboard-only promotion.                                            |
| UI-005 | Move list (60-move game)                     | Import 60-move PGN, observe list, scroll                                                        | Auto-scrolls to latest, readable, wraps, current move highlighted, reachable when inspecting history                                               | Auto-scroll via `scrollIntoView({block:nearest})` works, but max-height 168px may be small for 60 moves (30 rows) — still scrollable but no jump-to-move, no replay controls                                                                                                                                                                          | P1       | v0.1.0 only shows list, no replay viewer; requirement asks replay viewer (C2)                                                              | For A: ensure auto-scroll works, add `overflow-anchor` fix. For C2: implement replay viewer: step forward/back, jump start/end/number, current move highlighted, comments shown.                                                                                                                                                                        | Test: load 120-ply PGN, assert last row visible after render, `scrollIntoView` called.                                    |
| UI-006 | Focus and dialogs                            | Open Settings, PGN, Promotion, press Tab, Shift+Tab, Escape, then async action (copy)           | Focus trap inside dialog, initial focus sensible, focus restore on close, no focus lost after async copy                                           | Settings dialog opened via inline onclick in main.js, no focus management; PGN dialog same; after `copyText` async, focus stays but message may steal? No trap beyond native dialog, but initial focus not set; after close, focus returns to document body                                                                                           | P1       | Missing focus management code                                                                                                              | Add focus trap helper (native dialog already traps, but set initial focus), store previously focused element, restore on close. After async actions, keep focus on triggering button.                                                                                                                                                                   | Unit: focus restore test. Axe-core: no focusable outside dialog when open.                                                |
| UI-007 | Dark mode / contrast                         | Switch theme light/dark, check disabled buttons, borders, board squares, status colors          | WCAG AA contrast, disabled states visible, board readable in both themes, no unreadable greys                                                      | Dark theme: status success #9fe3bb on #161c24 ~ 8:1 OK, but waiting #a8c8f5 similar; error #ffb3ba OK. Light theme: status colors overridden but board squares #f0d9b5/#b58863 contrast with white/black pieces? White piece #fdfdfd on light square #f0d9b5 low contrast. Disabled opacity 0.5 may fail AA.                                          | P1       | Theme variables not tested for contrast; piece colors use shadows but still low contrast on light squares                                  | Adjust piece colors for light theme, add border/shadow, increase disabled opacity contrast, add outline for disabled. Run axe-core in both themes.                                                                                                                                                                                                      | Axe-core test both themes, assert 0 violations. Visual: screenshot light/dark.                                            |
| UI-008 | Async states                                 | Click e2e4 quickly twice, click Ask AI twice, click Undo during sending                         | Every awaited action shows progress (status waiting), button disabled to prevent double-fire, failures rollback optimistic UI and give next action | `selectSquare` awaits `playHumanMove` which awaits `sendPrompt`; second click during await may interleave; `askAi` disabled during SENDING but Undo/NewGame not; human move applied optimistically before send — if send fails, board stays in AI-turn state with no rollback, confusing                                                              | P0       | No guard flag for in-flight human move, no rollback                                                                                        | Add `#busy` flag, disable board (`is-static`) during SENDING/AWAITING, disable Undo/NewGame during SENDING, show spinner/progress in status. On send failure, offer retry and optionally undo last human move with confirmation (or keep but explain). Ensure `copyText` shows progress.                                                                | Unit: double-click test — second selectSquare ignored while busy. E2E: rapid clicks.                                      |
| UI-009 | Destructive actions                          | Click New game with 30 moves played                                                             | Offers undo or confirmation                                                                                                                        | New game immediately resets, no confirmation, no undo                                                                                                                                                                                                                                                                                                 | P1       | No destructive guard                                                                                                                       | Implement undo stack for game reset: store previous snapshot in memory + `chrome.storage.local` under `lastDeletedGame`, show status “Game deleted — Undo” with 10s timeout. Same for PGN load that replaces game. Add confirmation dialog for “Clear history” when library exists (C2).                                                                | Unit: reset then undo restores.                                                                                           |
| UI-010 | Theme flash                                  | Set theme light, close panel, reopen, watch first paint                                         | Stored theme applies before first paint, no flash                                                                                                  | `sidepanel.html` hardcodes `data-theme="dark"`; `app.js` reads storage async and then sets `document.body.dataset.theme` — flash visible                                                                                                                                                                                                              | P1       | Async storage read after paint                                                                                                             | Add inline `<script>` in `<head>` that reads theme from `localStorage` cache (mirrored on save) and applies immediately; also use `chrome.storage.local` async to correct. Alternatively, add `<style>` that hides body until theme applied, and set `color-scheme`. Implement `theme.js` that syncs `chrome.storage` → `localStorage` cache. No flash. | Playwright: measure first paint theme, assert no flash via screenshot comparison.                                         |
| UI-011 | Empty/error states                           | No AI tab, unsupported page, no history, storage full, bad PGN                                  | Each is designed state with icon, text, next action                                                                                                | No AI tab handled (status OPEN_AI), but storage full not handled (`writeValue` returns false ignored), bad PGN handled in dialog but not in main status, no game state is just empty board (OK), unsupported page same as no AI tab (could be more specific)                                                                                          | P1       | Missing storage quota handling, missing global error boundary                                                                              | Add `try/catch` around storage writes, detect `QUOTA_BYTES` error, show “Storage full — delete old games” action. Add empty state illustrations (CSS). Bad PGN: show in status line too.                                                                                                                                                                | Unit: simulate storage full by mocking `chrome.storage.local.set` throwing.                                               |
| UI-012 | Long content                                 | Paste 5000-char AI reply, 120-move PGN, very long player name in PGN header                     | Nothing overflows, controls stay visible, scroll inside                                                                                            | FEN uses `overflow-wrap:anywhere` OK, but PGN textarea may grow large, history list may grow, status line may wrap long text (currently `min-height:38px` but no max). Long player name not displayed in UI currently, but will be in C2 library                                                                                                      | P2       | No max-height on status, no line-clamp                                                                                                     | Add `overflow-wrap:anywhere` to status, `max-height` + `overflow-y:auto` to history, `word-break` for PGN. Add test with 5000-char string.                                                                                                                                                                                                              | Unit: render with long strings, assert no scrollWidth overflow.                                                           |
| UI-013 | Status line                                  | Trigger various errors: no tab, send fail, illegal AI move, check                               | Always answers “what happened + what to do now”, never bare code                                                                                   | Some messages are bare: “The AI tab did not answer.” (from normaliseResponse) or error from runtime; also “Could not find the chat input box” is actionable but could be more specific with diagnostics                                                                                                                                               | P1       | Generic error messages from messaging.js                                                                                                   | Rewrite status messages to be user-facing: include platform name, next action, and diagnostic hint. Ensure no raw error codes shown.                                                                                                                                                                                                                    | Unit: describeStatus with each phase, assert message contains verb + action.                                              |
| UI-014 | A11y                                         | Play full game keyboard-only, check aria-live, focus, color-alone                               | Keyboard-only full game, aria-live announcements, per-square labels, visible focus, no color-only info                                             | Keyboard play works via arrow keys + Enter, but no aria-live announcement of move (status is polite but not move-specific), per-square labels exist, focus visible via outline, but check is only radial gradient + status text — status helps but board alone uses color; last-move and selected use box-shadow only, but also aria-selected + label | P1       | Missing aria-live move announcements, missing non-color indicator for check                                                                | Add `aria-live` region for move announcements (`White e2e4, Black e7e5`), add check indicator via `::before` text or icon plus status, add `aria-describedby` for check. Ensure board has `aria-label` per square already. Add high-contrast board theme (C3). Run axe-core.                                                                            | Axe-core 0 violations, keyboard-only game test.                                                                           |
| UI-015 | Badge + title                                | Play move, undo, new game, switch tab, check                                                    | Badge reflects turn/check, stays in sync after undo/load/new/switch                                                                                | Badge only shows “AI” when supported, not turn/check                                                                                                                                                                                                                                                                                                  | P1       | `panel.js` only sets badge text to “AI”, no turn logic                                                                                     | Extend badge to show “W”/“B” or “✓” for check? Spec says badge reflects turn/check. Implement: when game in progress and AI tab active, badge = “W” if white to move, “B” if black, “!” if check, “AI” if no game. Update on every `ACTIVE_TAB_CHANGED` and on game state changes via message from panel to background. Add tests.                      | Unit: describeTab + badge logic, integration via fake-chrome.                                                             |

Additional P2 cosmetic:

- UI-016 Flip override not persisted, resets on reload.
- UI-017 Settings dialog has no reset button.
- UI-018 Copy FEN/PGN feedback disappears after next render (message overwritten).
- UI-019 No loading spinner for PGN import.

All P0/P1 must be fixed in Workstream A.

---

## 3. Integration Risks (AI-host bridge)

| ID    | Host(s)             | Risk                                                                              | Impact                                                                        | Current Mitigation                                                         | Required Fix                                                                                                                                                                                                                                                                                           | Verification                                                                                                                                          |
| ----- | ------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001 | All                 | Composer selectors never verified against live sites, depend on single class hash | P0 — prompts never sent, dead end                                             | Generic fallbacks (`textarea`, `contenteditable`)                          | Platform registry v2: ordered candidate list per role with strategy (textarea, contenteditable, ProseMirror, Lexical, aria-label, testid, form ancestor). Prefer semantic selectors (`[aria-label*='prompt']`, `[data-testid]`) that survive redesign. Add diagnostics showing which selector matched. | Playwright against sanitized DOM fixtures for each host (local fixtures). `e2e:live` against real sites with logged-in profile, screenshots, timings. |
| R-002 | Claude, Gemini      | Rich editors (ProseMirror, Quill) ignore `value` setter                           | Typing appears to succeed but composer stays empty, empty prompt submitted    | `setNativeValue` + `execCommand`                                           | Try strategies in order: `execCommand('insertText')`, native setter + input/change, `InputEvent` with `inputType:insertText`, ProseMirror/Quill specific: focus, select all, insert, dispatch `beforeinput`. Read back composer text after each attempt, only proceed when text present.               | Unit: fake editors, assert read-back. Fixture tests.                                                                                                  |
| R-003 | All                 | Submit with no confirmation, double submission                                    | Prompt sent twice, AI sees duplicate, or prompt not sent but UI thinks it was | Click button → Enter fallback, wait 400ms for composer empty               | Submit with confirmation: click send → Enter → `requestSubmit()`, then wait for new user message element to appear (via MutationObserver on transcript), guard against double submit with in-flight flag, never submit twice for one move.                                                             | Fixture: assert user message appears.                                                                                                                 |
| R-004 | All                 | Response extraction fragile, picks wrong container, misses streaming              | AI move ignored, game stuck                                                   | Scan newest container after 600ms quiet, 2.5s max, filter echo, dedupe 15s | Per-host assistant selectors + generic fallbacks, wait for streaming to settle (stable text for 800ms), ignore prompt echoes, handle markdown/code fences, normalize SAN: figurine unicode (♔♕♖♗♘♙), `0-0`/`O-O`, `e8=Q+`, annotations, numbered lists, moves inside prose.                            | Fixture tests for each host: streaming simulation.                                                                                                    |
| R-005 | All                 | Recovery only for illegal move, not for “plan” reply with no move                 | Game stalls when AI explains instead of moving                                | Retry on illegal only                                                      | Detect “no move found” after settled response → ask again with stricter instruction (“Reply with exactly one move in brackets…”). Bounded retries with backoff (maxRetries).                                                                                                                           | Unit: retry prompt builder, backoff timer.                                                                                                            |
| R-006 | All                 | No degraded mode when composer missing                                            | Dead end, user cannot play                                                    | Error message only                                                         | If composer not found, show “Copy prompt” button that copies exact prompt to clipboard, plus diagnostics. Never dead end.                                                                                                                                                                              | E2E: simulate missing composer, assert copy button works.                                                                                             |
| R-007 | All                 | No diagnostics                                                                    | User cannot report issue, dev cannot debug                                    | Logs only                                                                  | Add diagnostics section in panel: detected platform, matched selector per role, timings (findInput, type, submit), last error, copy report button (no upload).                                                                                                                                         | Unit + E2E screenshot.                                                                                                                                |
| R-008 | All                 | Multi-tab lifecycle: panel targets stale tab, orphan observers, timers leak       | Prompt sent to wrong tab, memory leak                                         | Debounced tab tracker in background                                        | Panel always targets tab user is looking at: listen to `ACTIVE_TAB_CHANGED`, update connection, cancel in-flight timers on tab close/navigation/unsupported. Background restart: persist last active tab id, recover. No orphan observers: `MoveWatcher.stop()` on navigation.                         | Unit: tab close simulation, assert timers cleared.                                                                                                    |
| R-009 | ChatGPT, Perplexity | Virtualized transcript, messages recycled                                         | Observer misses move because container removed                                | Single MutationObserver on body, pending queue 8                           | Keep pending queue but also scan existing DOM on start, and on `visibilitychange`. Increase queue to 16, add periodic scan every 5s while awaiting.                                                                                                                                                    | Fixture with virtualized list.                                                                                                                        |
| R-010 | All                 | Security: AI output, PGN, clipboard treated as untrusted but not fully bounded    | XSS or DoS via long reply                                                     | `textContent` only, max length 20k, validation                             | Keep validation, add length bound on PGN import (max 5000 moves), sanitize before render, never use innerHTML.                                                                                                                                                                                         | Security tests in markup.test.js extended.                                                                                                            |

Single biggest risk: R-001/R-002 — selectors unverified. Must close first.

---

## 4. Phased Plan

### Phase A — Fix UI defects (audit → fix → regression test)

**Goal:** All P0/P1 from table fixed, no regressions, `npm run verify` green, screenshots before/after.

**Steps:**

1. A0: Add theme flash fix (inline script + localStorage cache) — acceptance: no flash at 280px, light theme first paint is light.
2. A1: Board interaction — pointer events drag&drop + hover preview + touch/pen.
   - AC: drag e2→e4 moves, hover shows dot/ring, touch works, click-click still works, animation 150-200ms respects `prefers-reduced-motion`.
   - Test: fake-dom pointer events + Playwright drag.
3. A2: Focus/dialogs, promotion, a11y.
   - AC: keyboard-only full game, focus trap, focus restore, Escape cancels promotion, aria-live announcements.
   - Test: axe-core 0 violations both themes, keyboard test.
4. A3: Narrow panel, long content, dark mode, empty states.
   - AC: 280→900px no horizontal scrollbar, no clipped controls, board scales, FEN/PGN wrap, dark/light contrast AA.
   - Test: Playwright widths, screenshots.
5. A4: Async states, destructive undo, status line, badge+title.
   - AC: no double-fire, progress shown, rollback on failure with next action, New game offers undo, badge reflects turn/check and stays sync after undo/load/new/tab switch.
   - Test: double-click, storage full mock, badge logic.

**Evidence for A:**

- `artifacts/screenshots/a-before/` vs `a-after/` at 280,400,600,900 widths, dark/light.
- Axe-core report JSON, 0 violations.
- Test count: existing 164 + new regression tests (~20).
- Performance: panel TTI measured via `performance.now()` in sidepanel.html, board render time.

### Phase B — Make AI-host integration trustworthy

**Goal:** Rebuild bridge as verifiable, diagnosable.

**Steps:**

1. B0: Platform registry v2.
   - Per host: ordered candidate selectors per role with strategy enum: `textarea`, `contenteditable`, `proseMirror`, `lexical`, `quill`, `aria-label`, `testid`, `form-ancestor`.
   - Prefer semantic: `textarea[aria-label*='message' i]`, `div[contenteditable][role='textbox']`, `[data-testid*='composer']`, `form`.
   - Never depend on single class hash; at least 3 candidates per role.
   - AC: registry has >=3 candidates per role, includes strategy, documented in DEVELOPMENT.md.
   - Test: platforms.test.js asserts count and strategy.
2. B1: Typing that actually registers + read-back.
   - Strategies in order: `execCommand('insertText')`, native setter + input/change, `InputEvent`, framework-specific (ProseMirror: dispatch `beforeinput`, set `textContent` inside `.ProseMirror`, Quill: `.ql-editor`).
   - After each, read back `isComposerEmpty` false and text includes prompt substring.
   - AC: typing returns true only when read-back succeeds, never submits empty.
   - Test: fake editors for each strategy.
3. B2: Submit with confirmation.
   - Try: click send → Enter → `form.requestSubmit()`.
   - Confirm new user message appeared (observe transcript for user selector).
   - Guard double submit: in-flight flag.
   - AC: submit returns method + confirmed user message, never double submits.
4. B3: Response extraction.
   - Per-host assistant selectors, wait for streaming settle: text stable for 800ms or max 4s.
   - Ignore echo, handle markdown/code fences, normalize SAN: figurine unicode → letters, `0-0`→`O-O`, `e8=Q+`→`e8=Q`, annotations removed, numbered lists, multiple moves.
   - AC: extraction returns newest move, handles all normalization cases.
   - Test: prompt.test.js extended + fixture tests.
5. B4: Recovery + degraded + diagnostics.
   - Illegal reply → restate FEN + retry bounded with backoff (500ms, 1s, 2s).
   - Plan reply (no move) → stricter instruction retry.
   - Host DOM changed → show which selector failed, offer clipboard fallback.
   - Degraded: one-click copy prompt.
   - Diagnostics section: detected platform, matched candidate per role, timings, last error, copy report button.
   - AC: recovery bounded, never infinite, degraded always available.
6. B5: Multi-tab lifecycle.
   - Panel targets active tab, background restart handled, tab close/navigation handled, no stale timers/observers.
   - AC: no orphan timers, no prompt to closed tab.

**Evidence for B:**

- `test/fixtures/hosts/` — sanitized DOM snapshots for 6 hosts (Gemini, ChatGPT, Claude, Grok, Perplexity, Copilot) with composer + transcript.
- Playwright fixture tests: for each host, assert detection, typing, submit, extraction, echo filtering.
- `artifacts/e2e-live/` — if real browser available, screenshots + timings per host; otherwise mark unverified and document recipe.
- Diagnostics copy-paste sample.

### Phase C — Required feature set

#### C1. Board & interaction

- Drag & drop pointer events (mouse/touch/pen) + click-click, legal-move affordances (dot empty, ring capture), highlighting selected/last/check/hover, animated moves 150-200ms respecting reduced-motion, board flip, auto orientation for chosen color, coordinates toggle, copy FEN, paste FEN with validation errors, copy position, optional WebAudio sounds (move/capture/check, off by default, remembered).
- AC: all affordances visible, animation respects media query, flip persists, FEN paste validates and shows clear error, sounds off by default, no asset files.
- Tests: board-view.test.js + new sound tests (mock AudioContext), FEN paste validation.
- Docs: README feature list, DEVELOPMENT.md.

#### C2. Game management & PGN

- Local game library in `chrome.storage.local`: list, open, rename, duplicate, delete with undo, title/date/result/color, final position, resumable in-progress.
- Import PGN from file, clipboard, textarea; export download .pgn + copy clipboard; replay viewer step forward/back, jump start/end/number, current move highlighted, comments shown.
- Autosave debounced quota-aware, schema v2 with migration from v0.1.0 tested, corrupt records discarded without losing rest.
- Optional clock off by default counting both sides.
- AC: library persists, migration tested, quota-aware (handle QUOTA_BYTES), import/export round-trip, replay viewer works keyboard-only.
- Tests: game.test.js extended, storage migration test, PGN round-trip with comments.
- Evidence: storage migration test log, PGN export file.

#### C3. i18n & personalisation

- `en` and `vi` locales as ESM dictionaries with `t()` interpolation + pluralisation, chosen from `chrome.i18n.getUILanguage()`, switchable live in settings; `_locales/` for manifest name/description; test fails when dictionaries diverge or string bypasses `t()`.
- Themes: light/dark/system (no flash), several board themes including high-contrast, font scale, comfortable/compact density, all persisted and resettable.
- Keyboard shortcuts (new game, undo, flip, copy PGN, focus board) + “?” help dialog, registered via `chrome.commands` where sensible, never stealing keys from AI chat input.
- AC: all user-facing strings via `t()`, locale switch live, system theme follows OS, board themes switch, shortcuts work and are documented, no key stealing.
- Tests: i18n divergence test, locale switch test, axe-core both locales.
- Docs: README, DEVELOPMENT.md.

#### C4. Analysis & training (local engine, zero-dependency)

- Add search to `src/core`: iterative deepening alpha-beta with quiescence, Zobrist keys + transposition table, MVV-LVA + killer/history ordering, node/time budgets — running in Worker so UI never freezes, cancellable, results discarded when panel closes.
- Features: Hint (best move arrow), eval bar, move classification (blunder/mistake/inaccuracy/good) with thresholds, “analyse game” accuracy report + biggest swings, play vs local engine 6-8 levels (depth + deliberate weakness), play from any position, retry from here.
- Every judgement labelled heuristic, plain language, no false precision. Keep perft exact, add search tests (mate-in-N, tactics, determinism fixed node budget, cancellation). `src/core` stays pure DOM-free.
- AC: search finds mate-in-1/2, tactics, deterministic under fixed nodes, cancellable, Worker not blocking UI, eval bar updates, hint arrow drawn, analysis report shows accuracy and swings, engine levels differ.
- Tests: perft still exact, new search tests, Worker cancellation test.
- Evidence: search latency numbers, node counts, eval bar screenshot.

---

## 5. Verification Bar

### Local host fixtures

- Capture real composer/transcript DOM once per product, sanitise (remove user content, keep structure), commit as `test/fixtures/hosts/<id>.html` + `.json` with selector match info.
- Playwright drives extension against fixtures in CI: detection, typing, submit, extraction, echo filtering.
- **Status:** fixtures to be created in B0; harness to be added as `npm run test:fixtures` and `npm run e2e:fixtures`.

### Side panel e2e

- Launch persistent Chromium context with extension loaded, read id from service-worker URL, open `chrome-extension://<id>/sidepanel.html` directly.
- Drive full game against fake host page, screenshots.
- Command: `npm run e2e:panel` (new).

### Real hosts

- `npm run e2e:live` uses persistent profile in headful mode, user logs in once, suite runs each product, saves screenshots + timings to `artifacts/e2e-live/`.
- **Honesty:** If sandbox cannot run real browsers or has no logged-in session, say plainly in PR, ship harness + recipe, mark hosts as unverified. Never claim verification not performed.

### No flakiness

- Deterministic waits (`waitFor` with explicit conditions), no sleeps, retries only for genuinely racy UI.

### Also required

- axe-core dev-only on side panel both themes + both locales, 0 violations.
- Manual checklist documented for anything automation cannot cover (e.g., real chat login).

**Evidence to produce:**

- `artifacts/screenshots/` before/after for UI work.
- `artifacts/a11y/` axe reports.
- `artifacts/e2e-live/` or `UNVERIFIED.md` with recipe.
- Test counts, coverage (`npm run test:coverage`), performance numbers (panel TTI, board render, search latency, memory via `performance.measureUserAgentSpecificMemory` if available).
- Live-host verification status per product table.

---

## 6. Version Bump & Docs

- `APP_VERSION` in `src/shared/meta.js` → `0.2.0`, `npm run sync:manifest`.
- `CHANGELOG.md` entry Keep a Changelog, `CITATION.cff`, `PRIVACY.md` if data flow changed, `README.md` feature list, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md` (e2e + release), `docs/STORE_LISTING.md`, `docs/FAQ.md`.
- Finish: `npm run verify && npm run package` green, CI green, PR to main ready, squash merge, attach release archive.
- Stop before tag `v0.2.0`, GitHub release, adding dependency, changing permission list, irreversible.

---

## 7. Questions (blocking, max 3)

1. **Permissions:** C3 mentions `chrome.commands` for shortcuts. Adding `commands` to manifest is not a permission but a manifest key. May I add `commands` (and optionally `clipboardWrite` if needed for reliable copy fallback)? If not, I will implement shortcuts via in-panel key handlers only and avoid manifest commands.

2. **Storage quota for game library (C2):** Library may grow. Should I enforce a hard limit (e.g., 50 games, LRU eviction) and document it, or allow unlimited until quota error and then show “storage full” with delete action? I propose 50-game LRU with quota-aware fallback.

3. **Board themes & high-contrast:** Are there any brand constraints on board colors, or may I introduce 4 themes (classic, blue, green, high-contrast) with high-contrast meeting WCAG AAA for squares? I will proceed with 4 unless told otherwise.

If no answer, I will proceed with: no new permissions (commands via manifest key only if allowed, otherwise in-panel), 50-game LRU, 4 board themes.

---

## 8. Next Steps

- Await answers to 3 questions (or proceed after 24h with defaults).
- Start Phase A0 (theme flash) + A1 (board drag&drop) on branch `arena/01a0cea4-chess-with-ai`, small conventional commits, tests green each commit.
- Create `test/fixtures/hosts/` and begin B0 platform registry v2 in parallel.

No code changed in Phase 0 — this doc is the only artifact.
