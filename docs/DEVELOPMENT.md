# Development guide

## Quick start

```bash
git clone https://github.com/coderunknow/Chess-With-AI.git
cd Chess-With-AI
npm ci                # dev-only dependencies: eslint, prettier
npm run verify        # manifest check + lint + format check + 140+ tests
```

Then load the extension:

1. `chrome://extensions/` → enable **Developer mode**
2. **Load unpacked** → select the repository folder
3. Open `https://chatgpt.com` (or any supported host), click the extension icon
4. Play a move and watch the prompt appear in the chat

There is no build step and no bundler. Editing a file and clicking **Reload** on the extension card is the whole
loop. The side panel re-reads its own files when it is reopened; the content script needs the AI tab reloaded too.

## Commands

| Command                                   | Purpose                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `npm test`                                | all `node:test` suites                                                      |
| `npm run test:coverage`                   | same, with the Node coverage report                                         |
| `npm run lint` / `npm run lint:fix`       | ESLint (flat config)                                                        |
| `npm run format` / `npm run format:check` | Prettier                                                                    |
| `npm run check:manifest`                  | validate `manifest.json` against the platform registry and the module graph |
| `npm run sync:manifest`                   | regenerate the generated manifest fields                                    |
| `npm run dev:smoke`                       | drive the bridge/core against the doubles and print a scripted game         |
| `npm run package`                         | `build/ai-chess-companion-<version>.zip` for the store                      |
| `npm run verify`                          | everything CI runs                                                          |

## Testing without a browser

`test/helpers/` contains two doubles that make the whole extension testable in Node:

- **`fake-dom.js`** — elements with the small surface the UI actually uses (class list, dataset, listeners,
  `closest()` for `data-*` lookups, replaceable clipboard).
- **`fake-chrome.js`** — records every `tabs.sendMessage`, scripts the active tab, and implements
  `chrome.storage.local` in memory.

`test/app-flow.test.js` boots the real `App` against those doubles, so the turn/retry/undo/persistence rules are
covered without launching Chrome. The only thing they cannot cover is a real site's DOM — that is what the manual
checklist below is for.

## Debugging

| Surface        | How                                                                    |
| -------------- | ---------------------------------------------------------------------- |
| Side panel     | right-click inside the panel → **Inspect**                             |
| Content script | AI chat tab → DevTools → Console, filter `AI Chess Companion:content`  |
| Service worker | `chrome://extensions/` → **service worker** link on the extension card |
| Log levels     | `setLogLevel` in `src/shared/log.js`; the default is `INFO`            |

The panel exposes its state for quick poking in the console:

```js
__AI_CHESS_COMPANION__.app.session.fen;
__AI_CHESS_COMPANION__.app.session.history;
```

## Manual test checklist

Run this before a release (it is the part automation cannot reach):

- [ ] Panel opens from the toolbar icon; the badge shows `AI` only on supported hosts
- [ ] A human move produces a prompt in the chat and auto-submits
- [ ] The AI's `[e7e5]` reply moves the black piece; the turn indicator returns to you
- [ ] An illegal AI reply triggers a retry prompt (and stops after the configured attempts)
- [ ] Promotion opens the chooser and plays the chosen piece
- [ ] Undo removes the pair; New game resets; Flip mirrors the board
- [ ] `Copy PGN` puts a valid PGN on the clipboard; `PGN…` can load it back
- [ ] Settings: switching to Black starts a new game and flips the board
- [ ] Reloading the panel restores the running game
- [ ] Checked on at least two hosts (ChatGPT + Gemini recommended)

## Adding an AI platform

1. Add an entry to `PLATFORMS` in `src/shared/platforms.js` (`id`, `name`, `hosts`, `input`, `send`, `assistant`, `user`).
2. Run `npm run sync:manifest` — this updates `host_permissions`, `content_scripts.matches` and
   `web_accessible_resources.matches` for you.
3. Run `npm run verify`.
4. Test the composer by hand (see below) and update the README, `PRIVACY.md` and `docs/STORE_LISTING.md`.

Selector guidance per site:

| Need        | Look for                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Composer    | the `textarea`/`contenteditable` the site focuses when you click the message box; prefer a stable `id` or `aria-label` |
| Send button | `data-testid`, `aria-label` containing "send"/"submit"; avoid index-based selectors                                    |
| AI replies  | the per-message wrapper (`article`, `[data-message-author-role]`); generic fallbacks already cover `article`/`.prose`  |

If a site's composer is not detected, run `bridge.findInput()` in the page console — the bridge logs the selectors
it used at debug level, which usually shows which one matched the wrong element.

## Code style

- 2 spaces, double quotes, semicolons, 120 column soft limit — enforced by Prettier.
- ES modules only; no default exports (named exports keep refactors honest).
- `core`/`shared` must stay free of DOM and `chrome.*` (enforced by ESLint).
- Never build DOM from strings: use `textContent` and element creation (AI output is untrusted).
- Validate anything that comes from a page, a message or storage before using it.
- Comments explain _why_; JSDoc types are expected on exported functions.

## Continuous integration

Two workflows live in `.github/workflows/`:

- `ci.yml` runs on every push and pull request. It lints, format-checks, runs the tests, validates the manifest and
  the module graph, and uploads the packaged archive as a build artifact.
- `release.yml` runs on `v*` tags. It repeats the full verification, refuses to publish when `manifest.json` does not
  match the tag, builds `build/ai-chess-companion-<version>.zip` and attaches it to the GitHub release. The upload
  is retried three times, and any partial asset is removed first, because `uploads.github.com` occasionally closes
  the connection (`EOF`). Use **Actions → Release → Run workflow** with an existing tag to rebuild a release
  without moving the tag.

## Releasing

1. Update `APP_VERSION` in `src/shared/meta.js` (single source of truth for the version).
2. Run `npm run sync:manifest` — it copies the version into `manifest.json`.
3. Add a `CHANGELOG.md` entry.
4. `npm run verify && npm run package` locally, and capture the output for the pull request.
5. Merge to `main`, then tag and push: `git tag -a v<version> -m "<version>" && git push origin v<version>`.
6. Let the `Release` workflow attach the archive, and confirm the release page lists
   `ai-chess-companion-<version>.zip` before announcing it.
7. Upload the same archive to the Chrome Web Store developer dashboard.

## Dependencies policy

Runtime dependencies stay at **zero**. Dev dependencies are limited to linting/formatting. If you need a real
library at runtime, open an issue first and document the trade-off in `docs/ARCHITECTURE.md` — the zero-build
promise (clone → load unpacked → play) is a feature, not an accident.
