# Architecture — AI Chess Companion

## Overview

Zero-build, Manifest V3 Chrome Extension with 3 core components:

```
manifest.json
  ├── background.js (service worker)
  ├── content.js (AI chat bridge)
  └── sidepanel.html + sidepanel.js (chess UI + engine)
```

## Components

### 1. background.js — Service Worker

Responsibilities:
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` on install/startup
- Maintain allowlist `AI_HOSTS` — enables side panel only on supported AI domains via `chrome.sidePanel.setOptions({ tabId, enabled })`
- Listen to `tabs.onUpdated`, `onActivated`, `onRemoved` to keep panel state in sync
- Handle `GET_ACTIVE_TAB` messages from side panel (returns active tab id/url)

No persistent state. Logs warnings only.

### 2. content.js — AI Chat Bridge

Runs at `document_idle` on all AI hosts.

**Input Detection:**
- Selectors: `textarea`, `div[contenteditable="true"]`, `[role="textbox"]`
- Filter by visibility, disabled, readOnly
- Sort by bottom-most in viewport (chat input usually at bottom)
- `waitForChatInput(timeout)` polls every 100ms

**Input Population:**
- `setNativeValue()` uses prototype setter to bypass React controlled components
- For contenteditable: uses `execCommand("insertText")` fallback to `textContent`
- Dispatches `input` + `change` events
- `findSendButton()` searches form, parent, document for send button selectors
- `submitInput()` tries button click, then synthesizes Enter keydown/keypress/keyup

**Move Extraction:**
- Regex: `/\[([a-h][1-8][a-h][1-8][qrbn]?)\]/gi` — UCI in brackets
- `getMoveFromText()` scans last matches first (latest move wins)
- `isOutgoingText()` avoids echoing own prompt
- `isInputOrUserNode()` filters user message nodes
- `reportMove()` debounces (3s same as prompt move, 15s duplicate)

**Observation:**
- `MutationObserver` on `document.body` subtree childList + characterData
- Inspects added nodes + target, looks for assistant message containers: `article`, `[role=article]`, `[data-message-author-role=assistant]`, class contains message/response
- Sends `chrome.runtime.sendMessage({ type: "AI_MOVE", move })`

**Messaging:**
- Listens for `SEND_CHESS_PROMPT` → `sendPrompt(prompt)` → returns { ok, method } or { ok:false, error }

Guard: `window.__AI_CHESS_COMPANION_LOADED__` prevents double injection.

### 3. sidepanel.js — Chess Engine + UI

**Engine:**
- Board: dict `square -> piece` e.g. `"e4" -> "P"`, empty `""`
- `parseFen()` parses FEN into board + sideToMove + castling + enPassant + halfmove/fullmove + history
- `cloneGame()` shallow clone for legality testing
- `isPseudoLegalMove()`:
  - Pawn: 1/2 step, diagonal capture + en passant, promotion implicit
  - Knight: L shape
  - Bishop/Rook/Queen: `pathIsClear()` ray casting
  - King: 1 step + castling check (rights, empty squares, rook present)
- `isSquareAttacked()` checks pawn, knight, king, sliding pieces
- `isInCheck()` finds king then checks attack
- `isLegalMove()` validates pseudo-legal + not leaving king in check + castling through check
- `makeMoveUnchecked()` applies move, handles capture, en passant capture, castling rook, promotion, castling rights update, en passant square, halfmove/fullmove, side toggle
- `toFen()` generates FEN
- `parseUci()` / `normaliseUci()` validates UCI

**UI:**
- Renders 8x8 grid of buttons, light/dark, selected, legal-target (dot), capture-target (ring), last-move highlight
- Uses Unicode glyphs `PIECE_GLYPHS`
- Elements: `#board`, `#status`, `#turn`, `#last-move`, `#fen`, `#reset`
- `render()` rebuilds board DOM
- `handleSquareClick()` selection logic: if white to move, select own piece → show legal targets → if click target → `handleUserMove`
- `handleUserMove()` validates via `applyMove()`, updates status, calls `sendMoveToAi()`
- `sendMoveToAi()`:
  - `getActiveTab()` via `chrome.tabs.query`
  - `isSupportedAiUrl()` check
  - `ensureContentScript()` tries `chrome.scripting.executeScript` fallback
  - Builds prompt with UCI + FEN + instructions
  - `sendTabMessage()` via `chrome.tabs.sendMessage`
- `handleAiMove()` parses UCI, checks turn is black, `applyMove()` with source "ai"
- Listens for `AI_MOVE` and `ACTIVE_TAB_CHANGED`, and initial `GET_ACTIVE_TAB`

**Styling (sidepanel.html):**
- CSS variables dark theme: `--bg #101317`, `--panel #171c23`, etc.
- Grid board aspect-ratio 1, responsive font clamp for pieces
- Status colors via `data-kind`

## Data Flow

1. User clicks piece → `selectedSquare` + `legalTargets` → render highlights
2. User clicks target → `handleUserMove` → `applyMove` (white) → `sendMoveToAi` → content script → AI chat
3. AI responds with `[e7e5]` → content script observer → `AI_MOVE` → side panel → `handleAiMove` → `applyMove` (black)
4. Turn back to white

## Security Considerations

- UCI regex strict, no eval
- Engine validates all moves before applying
- Content script never uses innerHTML with AI text
- No fetch to external servers
- Minimal permissions

## Future Extensibility

- Extract engine to separate module for unit testing
- Add `chrome.storage.local` for persisting game
- Add promotion chooser (currently auto queen)
- Add PGN/history UI
- Add icons + action default_popup fallback
- Add optional Stockfish WASM for analysis (not as opponent)

