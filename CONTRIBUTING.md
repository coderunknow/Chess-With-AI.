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
2. **Keep the layers intact** — `src/core` and `src/shared` must stay free of DOM and `chrome.*` access (ESLint
   enforces this). New chess rules belong in `src/core` with a test next to them; new site integration belongs in
   `src/shared/platforms.js`.
3. **Run the checks** before pushing:
   ```bash
   npm ci
   npm run verify      # manifest check + lint + format + tests
   ```
4. **Test manually** (add a real host case to the checklist in `docs/DEVELOPMENT.md` if you touched one):
   - Load unpacked in Chrome
   - Test on at least 2 AI hosts (e.g. Gemini + ChatGPT)
   - Verify legal move validation, castling, en passant, promotion
   - Check the toolbar badge only appears on supported hosts
5. **Commit** with clear messages ([Conventional Commits](https://www.conventionalcommits.org/)):
   - `feat: add drag-and-drop support`
   - `fix: handle claude.ai new input selector`
   - `docs: clarify UCI format in README`
6. **Push** and open a PR against `main` — fill the PR template

### Coding Guidelines

- **ES modules, no bundler** — the repository is the extension. Runtime dependencies stay at zero; open an issue
  before proposing one.
- **No external network requests** — all logic stays local, except prompts typed into the AI tab the user controls.
- **Accessibility**: keep `aria-label`s, keyboard navigation and `role="grid"` working. The board is fully keyboard
  operable and that must not regress.
- **Formatting** is automated: run `npm run format` (Prettier, 120 columns, double quotes).
- **Manifest**: never add `<all_urls>` or extra permissions; add the host to `src/shared/platforms.js` and run
  `npm run sync:manifest` instead.
- **Security**: no `eval`, no `innerHTML` with untrusted content. Use `textContent` and `createElement`; the checks
  in `test/markup.test.js` fail the build otherwise.
- **Tests**: new rules need a unit test; perft counts (`test/perft.test.js`) catch move-generation regressions.

### Good First Issues

- Add another AI platform (see the checklist in `docs/DEVELOPMENT.md`)
- Add a board theme (one `[data-theme]` block in `src/ui/theme.css`)
- Internationalise the side panel (all user-facing strings)
- Drag-and-drop pieces and move sounds
- An optional Stockfish/WASM analysis pane (`stockfish.wasm`) as a _helper_, not an opponent

## Development Setup

```bash
git clone https://github.com/coderunknow/Chess-With-AI.git
cd Chess-With-AI
npm ci            # dev-only tooling: eslint + prettier
npm test          # 140+ tests, no browser needed
```

Then load the folder via `chrome://extensions` → **Load unpacked**. There is no build step; the repository is the
extension. See [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) for the architecture, per-platform selector notes,
the manual test checklist and the release process.

## Questions?

Open a discussion or see [SUPPORT.md](./SUPPORT.md).

Thank you! ♞
