# Development guide

## Quick start

```bash
git clone https://github.com/coderunknow/Chess-With-AI.git
cd Chess-With-AI
npm ci                # dev-only dependencies: eslint, prettier
npm run verify        # manifest check + lint + format check + node:test suites
```

Then load the extension:

1. `chrome://extensions/` → enable **Developer mode**
2. **Load unpacked** → select the repository folder
3. Open `https://chatgpt.com` (or any supported host), click the extension icon
4. Open **AI chat connections**, pin that tab, then play a move and watch the one-shot prompt

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
- **`fake-chrome.js`** — records every `tabs.sendMessage`, scripts a pinned tab plus focus changes, and implements
  `chrome.storage.local`/`chrome.storage.session` in memory.

`test/app-flow.test.js` boots the real `App` against those doubles, so the turn/retry/undo/persistence rules are
covered without launching Chrome. `test/stockfish-binary.test.js` also boots the **real packaged JS/WASM bytes** under
Node, checks their source and GPL digests and plays a legal limited-strength move (the browser-worker UCI controller
is covered by a separate mocked-worker test). The only thing these cannot cover is a real site's DOM — that is what
the manual checklist below is for.

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

Browser automation cannot certify the live DOM of a hosted AI chat. Run this on **each of the six** platforms before store submission (Gemini, ChatGPT, Claude, Grok, Perplexity, Copilot):

- [ ] Pin one open supported tab. Check its platform/host/title in the picker and opponent line. Switch window focus: the next prompt still goes to the pinned tab, not the focused tab. Close or navigate the pin off-host: status explains that it was cleared, with no silent retarget.
- [ ] Wait while the site shows **Stop** or streams a reply. Send a chess move: the panel shows generation-wait status, never clicks Stop/presses Enter early, then sends exactly **one** complete prompt when ready. Test a slow or ambiguous send with Copy prompt fallback; a click must never be followed by Enter.
- [ ] Select Manual send, play a move: prompt is copied/offered, but the composer remains untouched. Paste/send it yourself; only the **new** assistant message can move the board.
- [ ] Submit an illegal AI move (pin, castling through check or missing promotion). Confirm the localized reason and a bounded `e2-e4` legal list in the correction. At max retries, status shows **Ask again** and no engine substitute plays.
- [ ] Click **Play Black / Play White** with a game in progress: confirm starts a new game and Black flips the board. Flip, tap-once, drag-and-drop, keyboard focus and no page jump from the move list still work at widths 280–900px.
- [ ] Pause: badge **OFF**, no prompts/observer/worker. Close/reopen the panel and/or restart the service worker: still paused. Resume: no old reply is re-emitted; request a new move intentionally.
- [ ] Turn on sound and vary volume: wood move/capture/check/castle/promotion/game-over sounds. Toggle animations and OS reduced motion: glide/fade or instant, respectively.
- [ ] Enable rated match with Auto mode/live pin: confirm a new game, UCI handshake shows its range, Stockfish plays only its side and the chat supplies only its side. Finish an actual game: n/W–D–L, estimate, 95% interval and **Stockfish UCI_Elo scale, not FIDE** appear. Stop a second game: no additional rated result. Test manual mode/no pin/WASM failure: controls refuse to start, show an error and do not fabricate a rating.
- [ ] PGN import/export, snapshot restore and library remain independent of match records; export match PGNs.

Automated tests cover six-host Stop detection, full-string composer verification, provenance, perft, pin/pause, estimator math and a complete rated Fool's Mate through a stubbed content bridge and worker. They do **not** claim that a live AI model achieved a scripted result.

## Adding an AI platform

1. Add an entry to `PLATFORMS` in `src/shared/platforms.js` (`id`, `name`, `hosts`, `input`, `send`, `stopCandidates`, `assistant`, `user`).
2. Run `npm run sync:manifest` — this updates `host_permissions`, `content_scripts.matches` and
   `web_accessible_resources.matches` for you.
3. Run `npm run verify`.
4. Test the composer by hand (see below) and update the README, `PRIVACY.md` and `docs/STORE_LISTING.md`.

Selector guidance per site:

| Need        | Look for                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Composer    | the `textarea`/`contenteditable` the site focuses when you click the message box; prefer a stable `id` or `aria-label` |
| Send button | accessible name/title/test ID containing send/submit; never match a Stop control or rely on a class hash               |
| Stop state  | accessible stop/cancel/interrupt/dừng names and site streaming markers; verify the request waits without clicking      |
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
5. Open a PR, wait for all CI checks, then merge into `main` without overrides. Tag **the merge commit** (not the feature branch): `git tag -a v<version> -m "v<version>" <merge-commit>`; push the tag only after verifying it points to the main merge commit.
6. Let the `Release` workflow attach the archive, and confirm the release page lists
   `ai-chess-companion-<version>.zip` before announcing it.
7. Upload the same archive to the Chrome Web Store developer dashboard.

## Dependencies policy

Runtime npm dependencies stay at **zero**. Dev dependencies are limited to linting/formatting. The separately
licensed `engine/stockfish/` JS/WASM pair is vendored, not an npm dependency or a runtime download. Its GPL-3
license and exact upstream source reference must accompany every packaged archive. The zero-build promise
(clone → load unpacked → play) is a feature, not an accident.
