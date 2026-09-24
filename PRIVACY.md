# Privacy Policy for AI Chess Companion

**Effective Date:** September 24, 2026

**Extension Name:** AI Chess Companion (Chess With AI)

**Version:** 0.5.0

## Summary

**No telemetry, analytics, backend, account or data sale.** Chess rules, heuristic analysis, and strength-limited **Stockfish.js 17.1 Lite** (GPL-3, vendored WASM) run on your device. The extension itself does not make remote `fetch`, XMLHttpRequest or WebSocket requests. The only network communication associated with playing is the chess prompt submitted to **your chosen AI chat** (automatically through that site's interface or manually pasted by you). The chat provider's privacy policy applies to that conversation.

## What the extension accesses

- The side panel shows your board, moves, settings and local analysis.
- The picker **lists open supported AI tabs only**. Their URLs identify the host; their `document.title` is read from their content scripts for display. You explicitly **pin one tab**, which is the only destination for chess prompts; changing window focus cannot move the pin. If the tab closes or leaves a supported host, the pin is cleared and no new chat is silently selected.
- The content script on the **pinned AI tab** locates its composer, reads new user/assistant message containers and validates a move from a new assistant reply. An old transcript or an echoed prompt cannot become a move. When paused, its observer disconnects; the script stays injected but idle. Closing the panel does not automatically pause it.
- **Auto** mode types a FEN/move/retry prompt into that chat and submits it once only after generation stops and the full prompt is verified. **Manual** mode only copies/offers the prompt; you paste and send it yourself. If a send cannot be confirmed, nothing is resubmitted automatically.
- Rated games use a packaged Stockfish worker, never an external rating service. Completed match PGNs, the Stockfish anchor, AI colour, outcome and platform ID support a local estimate on the **Stockfish UCI_Elo scale, not FIDE**.

## Data stored on your device

- `chrome.storage.local`: validated settings (including send mode and pause), the in-progress chess snapshot, the game library, and a separate versioned rated-match record containing PGNs and results. Imported PGNs and chess prompts can contain text you provided; stored data is not uploaded by the extension.
- `chrome.storage.session`, if available: `{tabId, url, platformId, title}` for **one pinned AI tab**. On browsers without session storage the pin falls back to `chrome.storage.local`. URLs and titles can include information about your own chats and stay on your device. This is **not** browsing-history collection.
- There are no cookies, ad IDs, tracking pixels or remote backups. Turning off **Remember the game** removes the running-game snapshot, not the separate match PGNs; use the Match export to save them yourself. Pause remains persisted until you resume.

## Permissions justification

- `sidePanel` — display the chess board beside your own chat.
- `storage` — retain local settings, the game, match records and a single pinned-tab reference.
- `scripting` — inject the already-packaged content bridge on a supported chat if it did not load.
- Host permissions — restricted to `gemini.google.com`, `chatgpt.com`, `chat.openai.com`, `claude.ai`, `grok.com`, `perplexity.ai`, `www.perplexity.ai` and `copilot.microsoft.com`. They let the extension list those supported tabs and run its content script there. No `tabs`, `management`, `<all_urls>` or browsing-history permission is requested. Unsupported pages are not scanned.

The extension page's CSP allows only packaged scripts and local WASM compilation (`'wasm-unsafe-eval'`); it grants **no remote code source**. The GPL-3 engine, license text and bundled corresponding source are in [`engine/stockfish/`](engine/stockfish/SOURCE.md).

## Third parties, changes and contact

The extension does not operate a third-party server. The AI chat provider you choose receives the prompts that you submit and may process them under its own terms. If privacy implications change, this policy and the store listing will be updated. For questions, open a GitHub issue or contact accicloudnha@gmail.com.
