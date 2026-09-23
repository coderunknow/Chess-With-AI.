# FAQ — AI Chess Companion

### Is this an AI chess engine?

No. This extension does NOT include Stockfish or any built-in AI opponent. It lets you play *with* LLMs like ChatGPT, Gemini, Claude, etc. The LLM is Black. You are White. The extension just bridges moves.

### Does it need an API key?

No. It automates the chat UI you already use. No OpenAI / Google API key needed.

### Why does the AI make illegal moves sometimes?

LLMs are not chess engines. They hallucinate. The extension validates moves locally and will show an error if illegal. Nudge the AI with the FEN: "That move is illegal. Current FEN: ... Please choose a legal move for Black in [brackets]."

### Which AI is best at chess?

In community testing:
- Claude 3.5 Sonnet and GPT-4o tend to be stronger
- Gemini 1.5 Pro decent
- Grok / Perplexity vary
All benefit from reminding them to use brackets and think step by step.

### Can I play as Black?

Not in v1.0.0. You are always White (you start). Black-as-player is on the roadmap.

### Can I undo a move?

Not yet. Use Reset button to start over. Undo/PGN history is planned.

### Does it work on mobile?

No, Chrome Extensions sidePanel API is desktop Chrome only.

### Why no icons in the toolbar?

v1.0.0 ships without icons to keep it minimal. Icons are in `/icons/` folder ready for next version. You can add them locally to manifest.json if you want.

### Is my chat data collected?

No. See PRIVACY.md. The only data sent is the chess prompt you see being typed into your AI chat. No external servers.

### Can I add another AI site?

Yes! See CONTRIBUTING.md and docs/DEVELOPMENT.md → "Adding a New AI Host". Open a PR.

### Does it work with chess.com / lichess.org?

No. It's designed for AI chat sites, not chess platforms. For chess.com/lichess you don't need this extension.

### How do I export the game?

Copy FEN from panel. PGN export coming soon. For now you can manually reconstruct from history.

### I found a bug where castling fails.

Check: castling rights in FEN (KQkq), squares empty, king not in check, king doesn't pass through check, rook still there. If still fails, open bug report with FEN.

