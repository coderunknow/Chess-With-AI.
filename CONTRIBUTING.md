# Contributing to AI Chess Companion

Thanks for considering contributing! This is a small, zero-dependency Chrome extension — we keep the bar friendly and low.

## Code of Conduct

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

- Use the Bug Report template in `.github/ISSUE_TEMPLATE/`
- Include:
  - Chrome version (`chrome://version`)
  - Extension version (from `manifest.json`)
  - AI host (e.g., gemini.google.com, chatgpt.com)
  - Steps to reproduce, expected vs actual behavior
  - Screenshots / console logs if relevant
- Check existing issues first to avoid duplicates

### Suggesting Features

- Use the Feature Request template
- Explain the use case, not just the solution
- For big changes, open an issue first to discuss

### Pull Requests

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Do not change core source without reason** — but improvements to `sidepanel.js`, `content.js`, `background.js` are welcome if they:
   - Preserve Manifest V3 compliance
   - Keep zero external dependencies
   - Maintain privacy-first approach (no external calls)
3. **Test manually**:
   - Load unpacked in Chrome
   - Test on at least 2 AI hosts (e.g., Gemini + ChatGPT)
   - Verify legal move validation, castling, en passant, promotion
   - Check side panel enablement only on whitelisted hosts
4. **Commit** with clear messages:
   - `feat: add drag-and-drop support`
   - `fix: handle claude.ai new input selector`
   - `docs: clarify UCI format in README`
5. **Push** and open a PR against `main` — fill the PR template

### Coding Guidelines

- **Vanilla JS only** — no bundler required (for now). If you propose adding a build step, discuss in an issue.
- **No external network requests** — all logic must stay local, except messages sent to the AI tab the user already controls.
- **Accessibility**: keep `aria-label`, keyboard focus, `role=grid` etc.
- **Style**: keep existing formatting (2-space indent in JS/JSON, readable CSS variables)
- **Manifest**: don't add broad `<all_urls>` or extra permissions without strong justification
- **Security**: no `eval`, no innerHTML with untrusted content. Use `textContent` and `createElement`.

### Good First Issues

- Add icons (16/48/128) and wire them in `manifest.json` *without breaking existing functionality*
- Add promotion chooser UI (currently defaults to queen)
- PGN export / move history list
- Theme toggle (light/dark)
- Add more AI hosts with testing
- i18n support
- Automated tests for chess logic (extract engine to testable module)

## Development Setup

No build needed:

```bash
git clone https://github.com/coderunknow/Chess-With-AI.git
# open chrome://extensions → Load unpacked → select folder
```

If you add tooling later, document it in README and keep `.gitignore` updated.

## Questions?

Open a discussion or see [SUPPORT.md](./SUPPORT.md).

Thank you! ♞
