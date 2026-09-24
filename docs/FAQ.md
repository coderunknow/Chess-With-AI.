# FAQ

### Which chat receives my chess prompts?

**Only the one supported tab you pin** in **AI chat connections**. The picker shows its platform, host and title (read by that tab's content script). Focus changes do not change the pin. If the tab closes or leaves a supported site, the pin clears; choose another explicitly. No `tabs` or `management` permission is needed.

### Does the extension press Enter when an AI is still answering?

No. Every supported host uses the same one-shot contract: detect Stop/streaming controls by their accessible name or site markers, wait for them to disappear (default 120 seconds, adjustable in AI settings), verify the **entire** prompt, then click a named Send/Submit button **once**. Enter is used **only** when no send button exists and the chat is not generating. There is no button → Enter fallback. A timeout or ambiguous result offers Copy prompt without retrying the keystroke. If the clipboard is blocked, click **Copy prompt** yourself.

### Can I send prompts myself instead?

Yes. Set **AI → Send mode → Manual**. It attempts to copy the prompt and presents **Copy prompt**; it never types, clicks Send or presses Enter. Paste and submit the prompt in your pinned tab. The observer waits for your complete user-message echo and then watches a new assistant reply. Rated matches require **Auto** mode.

### What happens if the AI's move is illegal?

The local rules engine refuses it. The status names the cause (empty origin, opponent's piece, a pin exposing the king, blocked castle, missing promotion, illegal en passant, etc.). A bounded correction restates FEN, side, history, every legal move in safe `e2-e4` notation and previously rejected moves. This list cannot be mistaken for an answer. After your configured maximum retries, the panel **stops** and shows **Ask again**; that button sends **one correction**. Neither Stockfish nor the heuristic worker takes the chat AI's turn.

### Can I play as Black or change sides during a game?

**Play Black / Play White** is next to Flip. If moves have been played, confirm ending the current game. This always starts a **new** game, using the existing Black-board-flip behaviour. It does not swap the colours of a game in progress. The setting in the dialog stays in sync.

### What does Pause do? Does closing the panel pause automatically?

Pause is soft: it disconnects the transcript observer and stops the local-search/Stockfish workers. The content script stays installed but refuses sends; the toolbar badge reads `OFF`. Pause is saved across service-worker restarts. Resume does not rescan old transcript history or re-emit an earlier reply; request a new reply when needed. Closing the panel does **not** auto-pause.

### Is the local Hint/Analyse/Play vs engine level an Elo rating?

No. The built-in search is a heuristic at levels **1–8**. Those levels do not have a calibrated Elo. **Play vs engine** starts a separate local game against that heuristic, not against the pinned chat. It cannot take a turn reserved for the chat AI.

### What is a Stockfish Elo match?

The packaged **Stockfish.js 17.1 Lite, single-threaded NNUE WASM** worker plays real chess moves against the chat AI in the pinned tab. It uses the engine's `UCI_LimitStrength` and reported `UCI_Elo` range (observed 1320–3190 for this binary), with `go movetime` (100–5000ms; default 500ms). The first rated game has the chat AI as White, the next rated game Black, alternating after each **completed rated** game. Choose an anchor in 10-point steps. Changing it starts a _separate estimate_; games at different anchors are never pooled.

Only checkmate, stalemate, fifty-move, threefold repetition, insufficient material, or an explicit assistant resignation after both sides have played are scored. Protocol errors, a stopped game, a lost pin and an illegal Stockfish move after one research retry are **unfinished / unrated**; they are not losses. The Analysis section reports **n**, AI-perspective **W–D–L**, bounded maximum-likelihood Elo and a **95% profile-likelihood interval**. It says **provisional** below eight games or while the interval is wider than 200 points. The label is always **Stockfish UCI_Elo scale, not FIDE**; it is neither a federation nor a website rating.

### Does the engine download or contact a server? What license is it?

No. The JS/WASM pair and NNUE are packaged with the extension, not fetched from a CDN and not an npm runtime dependency. The extension's own code is MIT; the separately vendored Stockfish component is **GPL-3**, and its license, **bundled byte-for-byte Lite source**, exact upstream revision and checksums ship in [`engine/stockfish/`](../engine/stockfish/SOURCE.md). The WASM CSP permission is local only.

### Does this need an API key? Is my game uploaded?

No extension account, API key, analytics or backend. Settings, the game/library, pin and rated PGNs stay in browser storage. The **prompt you send to your own chat** leaves your browser through that chat provider; its privacy terms apply. A chat title/URL can be stored locally while pinned. See [PRIVACY.md](../PRIVACY.md).

### How do I resume/import/export games?

The running board snapshot persists locally if **Remember the game** is on. **PGN…** imports a game; Copy PGN and the library export it. **Export match PGNs** exports the separate completed rated games. Invalid snapshot/match records are discarded independently, so corrupt match storage cannot wedge the board.

### The model stopped or no move arrived. What should I check?

1. A **live pinned tab** is required. If it navigated off a supported host, pin another explicitly.
2. If Stop/generation is visible, the bridge waits without sending. After the timeout, copy the prompt; do not press Enter to “wake” the model.
3. If the site changed its composer, choose Manual mode or **Copy prompt**. The bridge does not retry by clicking/typing twice. Diagnostics can be copied from the panel for a bug report.
4. For a rated game, a protocol failure ends it _unrated_; it is not evidence of chess strength.

### Firefox or other AI hosts?

Not supported in this release. Only the six declared AI platforms are in the manifest. No extra themes, piece sets, sound packs, permissions or network services are required.

For support, see [SUPPORT.md](../SUPPORT.md).
