# Support — AI Chess Companion

## Getting Help

- **Read the README** first: installation, usage, and how it works are covered in [README.md](./README.md)
- **Search existing issues** on GitHub — someone may have hit the same problem
- **Open a new issue** using the templates in `.github/ISSUE_TEMPLATE/`

## Common Issues & FAQ

### 1. Side panel doesn't open / says "Open an AI chat tab first"
- Make sure you're on a supported host:
  - gemini.google.com, chatgpt.com, chat.openai.com, claude.ai, grok.com, perplexity.ai, copilot.microsoft.com
- The extension enables the panel only on those hosts (see `background.js` → `AI_HOSTS`)
- Try reloading the AI tab and clicking the extension icon again
- Check `chrome://extensions` → AI Chess Companion → Errors

### 2. Move not sent to AI
- The AI site may have changed its input selector. The content script looks for `textarea`, `contenteditable=true`, `role=textbox` near the bottom of the viewport.
- Open DevTools console on the AI tab — look for errors from `content.js`
- Try clicking the chat input manually first, then make a board move
- Reload both the AI tab and the extension

### 3. AI replies but board doesn't update
- AI must return move in brackets: `[e2e4]` or `[e7e8q]` for promotion. Example: `I'll play [g8f6] developing the knight.`
- If AI writes `e5` without brackets, board won't parse it — nudge the AI: *"Please always return your move in brackets like [e7e5]"*
- The MutationObserver filters out user messages — ensure AI response is in an assistant role element

### 4. Illegal move from AI
- LLMs sometimes hallucinate. The extension validates with its local engine and shows: `"The AI returned illegal move [x]"`
- Just tell the AI: *"That move is illegal in this FEN: <paste FEN>. Please choose another legal move for Black in [brackets]."*
- FEN is displayed in the side panel — copy it

### 5. Castling / En Passant / Promotion not working
- Castling: ensure castling rights still present in FEN (`KQkq`), squares empty, king not in check, doesn't pass through check
- En passant: only immediately after opponent's double pawn push
- Promotion: currently auto-promotes to queen. Choose promotion UI is on the roadmap.

### 6. Extension not loading after Chrome update
- Go to `chrome://extensions` → toggle Developer Mode → Reload
- Remove and re-add via Load unpacked if needed

## Reporting Bugs

Use **Bug Report** template and include:
- Chrome version
- Extension version
- AI host URL
- Steps to reproduce
- Expected vs actual
- Screenshots / console logs

## Feature Requests

Use **Feature Request** template. Good ideas:
- PGN export, move history, undo
- Drag-and-drop, sounds, themes
- Promotion chooser
- Stockfish helper
- More AI hosts

## Contact

- GitHub Issues (preferred, public)
- Email: accicloudnha@gmail.com (for security/private matters)

## Supported Versions

Only latest `main` is supported. Please pull latest and reload.

Thank you for using AI Chess Companion! ♞
