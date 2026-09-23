/**
 * Side-panel bootstrap.
 *
 * Resolves every DOM reference used by {@link App} once, so that a mismatch
 * between `sidepanel.html` and the code fails loudly instead of silently
 * rendering nothing. `test/markup.test.js` asserts that the two stay in sync.
 *
 * @module ui/main
 */

import { App } from "./app.js";

/**
 * @param {string} id element id.
 * @returns {HTMLElement} the element; throws when it is missing.
 */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`AI Chess Companion: #${id} is missing from sidepanel.html`);
  }
  return element;
}

const app = new App({
  board: byId("board"),
  status: byId("status"),
  statusAction: byId("status-action"),
  turn: byId("turn"),
  opponent: byId("opponent"),
  fen: byId("fen"),
  moveList: byId("moves"),
  moveListEmpty: byId("moves-empty"),
  controls: {
    undo: byId("undo"),
    newGame: byId("new-game"),
    flip: byId("flip"),
    askAi: byId("ask-ai"),
    copyPgn: byId("copy-pgn"),
    openPgn: byId("open-pgn"),
    copyFen: byId("copy-fen"),
    statusAction: byId("status-action"),
  },
  platformBanner: {
    root: byId("connections"),
    select: byId("platform-select"),
    open: byId("open-platform"),
  },
  promotionDialog: {
    root: /** @type {HTMLDialogElement} */ (byId("promotion-dialog")),
    buttons: [...document.querySelectorAll("#promotion-dialog [data-piece]")],
  },
  settingsDialog: {
    root: /** @type {HTMLDialogElement} */ (byId("settings-dialog")),
    controls: {
      side: /** @type {HTMLSelectElement} */ (byId("settings-side")),
      theme: /** @type {HTMLSelectElement} */ (byId("settings-theme")),
      toggles: [...document.querySelectorAll("[data-setting]")],
    },
  },
  pgnDialog: {
    root: /** @type {HTMLDialogElement} */ (byId("pgn-dialog")),
    textarea: /** @type {HTMLTextAreaElement} */ (byId("pgn-text")),
    status: byId("pgn-status"),
    copy: byId("pgn-copy"),
    load: byId("pgn-load"),
    open: byId("open-pgn"),
  },
});

document.getElementById("open-settings")?.addEventListener("click", () => {
  document.getElementById("settings-dialog")?.showModal();
});

// Handy when debugging the side panel from DevTools.
globalThis.__AI_CHESS_COMPANION__ = { app };

void app.start();
