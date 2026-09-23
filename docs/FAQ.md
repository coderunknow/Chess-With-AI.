# FAQ

### Is this a chess engine?

It contains one — a complete rules engine that validates every move — but it is not an _opponent_. The AI you are
already chatting with plays the other side; the extension handles the rules, the board and the plumbing.

### Does it need an API key?

No. It automates the chat interface you already have open. There is no OpenAI/Google/Anthropic key, no account, and
no server in the middle.

### Do I need to install anything for development?

Only if you want to run the tests and linters (`npm ci`). The extension itself has no build step and no runtime
dependencies: `git clone`, load unpacked, play.

### Why does the AI sometimes answer with an illegal move?

Language models are not chess engines. The extension validates every reply and, by default, sends one corrected
request automatically ("`[e7e5]` is not legal in this position…"). If it still fails, the status line offers
**Ask again**. Fewer mistakes if you keep the chat focused and do not edit previous prompts.

### Which AI plays best?

Community experience points at the larger Claude and GPT models, with Gemini close behind; Grok and Perplexity vary
a lot by model. Bracketed-move compliance matters more than raw strength — a model that answers `[g8f6]` first time
is more fun to play than one that is stronger but rambles.

### Can I play as Black?

Yes. Settings → **Play as** → Black. A new game starts, the board flips, and the extension asks the AI to make the
first move.

### Can I resume a game after closing the panel?

Yes, as long as **Remember the game between sessions** is on (default). The position is stored locally in
`chrome.storage.local`; turning the option off deletes the stored game.

### Is my game uploaded anywhere?

No. There is no analytics and no external endpoint. The only thing that leaves your browser is the chess prompt
typed into your own AI chat — the same message you would type by hand.

### Why does nothing happen when I play a move?

Usually one of these:

1. **No supported AI tab is active.** The status line says so and offers **Open an AI chat**.
2. **The site changed its composer.** The content script falls back to generic selectors, but a redesign can break
   them. If the panel reports "Could not find the chat input box", please open an issue with the site name.
3. **The prompt was typed but not submitted.** Some sites require the send button; the bridge tries the button first
   and then Enter. If both fail you will see "Could not submit the prompt" — send it manually once and the
   extension will keep watching for the reply.

### Can I import a game I played elsewhere?

Yes — **PGN…** → paste → **Load into board**. Comments, variations, NAGs and `0-0`-style castling are tolerated.
Unreadable moves stop the import at that point and the panel tells you which move it could not read.

### Does the extension work in Firefox or Edge?

Edge can install Chrome extensions from the store and works. Firefox uses a different extension model (no side
panel API of the same shape, different `browser.*` namespace) and is not supported today.

### Why is the board so small in the side panel?

The board fills the panel width. Chrome lets you detach the side panel or widen it — the board scales with it. You
can also switch off **Show coordinates** and collapse the sections you do not need.

### How do I report a bug?

See [SUPPORT.md](../SUPPORT.md). Include the platform, Chrome version, extension version and what the status line
said — that usually identifies the failing layer immediately.
