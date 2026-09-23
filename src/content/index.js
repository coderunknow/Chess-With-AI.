/**
 * Content script bootstrap (classic script).
 *
 * Manifest V3 content scripts cannot be ES modules, so this file is the only
 * classic script in the extension: it guards against double injection and then
 * dynamically imports the real module. Every file reachable from `main.js` must
 * therefore be listed in `web_accessible_resources` — `npm run check:manifest`
 * (and CI) verifies that.
 *
 * @see docs/ARCHITECTURE.md
 */

(() => {
  const FLAG = "__AI_CHESS_COMPANION_BOOTSTRAPPED__";
  if (globalThis[FLAG]) {
    return;
  }
  globalThis[FLAG] = true;

  const entry = chrome.runtime.getURL("src/content/main.js");

  import(entry)
    .then((module) => {
      module.start();
    })
    .catch((error) => {
      globalThis[FLAG] = false;
      console.error("[AI Chess Companion:content] failed to load", entry, error);
    });
})();
