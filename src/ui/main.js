/**
 * Side-panel bootstrap — v0.2.0-patch1.
 *
 * Resolves every DOM reference used by {@link App} once, so that a mismatch
 * between `sidepanel.html` and the code fails loudly instead of silently
 * rendering nothing. `test/markup.test.js` asserts that the two stay in sync.
 *
 * v0.2.0-patch1: defensive unhide of theme-loading + global error handlers to
 * prevent black screen (CSP blocked inline scripts previously).
 *
 * @module ui/main
 */

import { App } from "./app.js";

// --- Black-screen safety net: ensure body is visible even if theme-init.js or this module fails ---
function forceVisible() {
  try {
    document.body?.classList.remove("theme-loading");
  } catch {
    void 0;
  }
  try {
    document.documentElement.style.background = "";
  } catch {
    void 0;
  }
}

// Immediate attempt (body may already exist)
forceVisible();

if (typeof window !== "undefined") {
  window.addEventListener("error", () => forceVisible());
  window.addEventListener("unhandledrejection", () => forceVisible());
  // Also try on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => forceVisible());
  }
  // Final safety after 1.5s
  setTimeout(forceVisible, 1500);
}

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

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function byIdOptional(id) {
  return document.getElementById(id);
}

let app;

try {
  app = new App({
    board: byId("board"),
    status: byId("status"),
    statusAction: byId("status-action"),
    turn: byId("turn"),
    opponent: byId("opponent"),
    fen: byId("fen"),
    moveList: byId("moves"),
    moveListEmpty: byId("moves-empty"),
    evalBar: byIdOptional("eval-bar"),
    evalFill: byIdOptional("eval-fill"),
    evalText: byIdOptional("eval-text"),
    clock: {
      root: byIdOptional("clock"),
      white: byIdOptional("clock-white"),
      black: byIdOptional("clock-black"),
      whiteTime: byIdOptional("clock-white-time"),
      blackTime: byIdOptional("clock-black-time"),
    },
    controls: {
      undo: byId("undo"),
      newGame: byId("new-game"),
      flip: byId("flip"),
      switchSide: byId("switch-side"),
      pause: byId("pause"),
      askAi: byId("ask-ai"),
      copyPgn: byId("copy-pgn"),
      openPgn: byId("open-pgn"),
      copyFen: byId("copy-fen"),
      statusAction: byId("status-action"),
      copyPrompt: byIdOptional("copy-prompt"),
      reloadTab: byIdOptional("reload-tab"),
      hint: byIdOptional("hint"),
      analyseGame: byIdOptional("analyse-game"),
      copyPosition: byIdOptional("copy-position"),
      pasteFen: byIdOptional("paste-fen"),
      playVsEngine: byIdOptional("play-vs-engine"),
      stopEngine: byIdOptional("stop-engine"),
      replayStart: byIdOptional("replay-start"),
      replayBack: byIdOptional("replay-back"),
      replayForward: byIdOptional("replay-forward"),
      replayEnd: byIdOptional("replay-end"),
    },
    platformBanner: {
      root: byId("connections"),
      select: byId("platform-select"),
      open: byId("open-platform"),
      list: byId("tab-list"),
      pinned: byId("pinned-tab"),
      refresh: byId("refresh-tabs"),
      unpin: byId("unpin-tab"),
    },
    match: {
      anchor: byId("match-anchor"),
      movetime: byId("match-movetime"),
      engineStatus: byId("match-engine-status"),
      start: byId("match-start"),
      stop: byId("match-stop"),
      export: byId("match-export"),
      estimate: byId("match-estimate"),
      scale: byId("match-scale"),
    },
    library: {
      root: byIdOptional("library-section"),
      list: byIdOptional("library-list"),
      empty: byIdOptional("library-empty"),
      search: byIdOptional("library-search"),
      import: byIdOptional("library-import"),
      exportAll: byIdOptional("library-export-all"),
      new: byIdOptional("library-new"),
    },
    analysis: {
      root: byIdOptional("analysis-section"),
      report: byIdOptional("analysis-report"),
      level: byIdOptional("engine-level"),
    },
    diagnostics: {
      root: byIdOptional("diagnostics-section"),
      platform: byIdOptional("diag-platform"),
      composer: byIdOptional("diag-composer"),
      send: byIdOptional("diag-send"),
      assistant: byIdOptional("diag-assistant"),
      timings: byIdOptional("diag-timings"),
      error: byIdOptional("diag-error"),
      report: byIdOptional("diagnostics-report"),
      copy: byIdOptional("copy-diagnostics"),
      toggle: byIdOptional("toggle-diagnostics"),
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
        locale: /** @type {HTMLSelectElement} */ (byIdOptional("settings-locale")),
        boardTheme: /** @type {HTMLSelectElement} */ (byIdOptional("settings-board-theme")),
        fontScale: /** @type {HTMLSelectElement} */ (byIdOptional("settings-font-scale")),
        density: /** @type {HTMLSelectElement} */ (byIdOptional("settings-density")),
        engineLevel: /** @type {HTMLSelectElement} */ (byIdOptional("settings-engine-level")),
        maxRetries: byId("settings-max-retries"),
        sendMode: byId("settings-send-mode"),
        generationWait: byId("settings-generation-wait"),
        soundVolume: byId("settings-sound-volume"),
        clockDuration: byId("settings-clock-duration"),
        interfaceDetail: byIdOptional("settings-interface-detail"),
        boardOrientation: byIdOptional("settings-board-orientation"),
        moveListFormat: byIdOptional("settings-move-list-format"),
        moveInteraction: byIdOptional("settings-move-interaction"),
        waitingReminder: byIdOptional("settings-waiting-reminder"),
        toggles: [...document.querySelectorAll("[data-setting]")],
        reset: byIdOptional("settings-reset"),
      },
    },
    pgnDialog: {
      root: /** @type {HTMLDialogElement} */ (byId("pgn-dialog")),
      textarea: /** @type {HTMLTextAreaElement} */ (byId("pgn-text")),
      status: byId("pgn-status"),
      copy: byId("pgn-copy"),
      load: byId("pgn-load"),
    },
    fenDialog: {
      root: /** @type {HTMLDialogElement} */ (byIdOptional("fen-dialog")),
      input: /** @type {HTMLTextAreaElement} */ (byIdOptional("fen-input")),
      status: byIdOptional("fen-dialog-status"),
      apply: byIdOptional("fen-apply"),
    },
    shortcutsDialog: {
      root: /** @type {HTMLDialogElement} */ (byIdOptional("shortcuts-dialog")),
    },
    libraryRenameDialog: {
      root: /** @type {HTMLDialogElement} */ (byIdOptional("library-rename-dialog")),
      input: /** @type {HTMLInputElement} */ (byIdOptional("library-rename-input")),
      save: byIdOptional("library-rename-save"),
    },
    announcements: byIdOptional("announcements"),
    fenStatus: byIdOptional("fen-status"),
  });

  document.getElementById("open-settings")?.addEventListener("click", () => {
    document.getElementById("settings-dialog")?.showModal();
  });

  // Compact "More" menu: Settings + Help live behind one header control.
  const moreButton = document.getElementById("more-button");
  const moreMenu = document.getElementById("more-menu");
  const closeMoreMenu = () => {
    if (moreMenu) moreMenu.hidden = true;
    moreButton?.setAttribute("aria-expanded", "false");
  };
  moreButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!moreMenu) return;
    moreMenu.hidden = !moreMenu.hidden;
    moreButton.setAttribute("aria-expanded", String(!moreMenu.hidden));
    if (!moreMenu.hidden) {
      moreMenu.querySelector("button")?.focus();
    }
  });
  document.getElementById("more-settings")?.addEventListener("click", () => {
    closeMoreMenu();
    document.getElementById("settings-dialog")?.showModal();
  });
  document.getElementById("more-help")?.addEventListener("click", () => {
    closeMoreMenu();
    document.getElementById("shortcuts-dialog")?.showModal();
  });
  document.addEventListener("click", (event) => {
    if (moreMenu && !moreMenu.hidden && !moreMenu.contains(/** @type {Node} */ (event.target))) {
      closeMoreMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMoreMenu();
  });

  // Keyboard shortcuts help: "?" key
  document.addEventListener("keydown", (event) => {
    if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
        return;
      }
      event.preventDefault();
      document.getElementById("shortcuts-dialog")?.showModal();
    }
  });

  // Handy when debugging the side panel from DevTools.
  globalThis.__AI_CHESS_COMPANION__ = { app };

  void app.start().catch((error) => {
    console.error("[AI Chess Companion] start failed", error);
    forceVisible();
    const status = document.getElementById("status");
    if (status) {
      status.textContent = `Startup failed: ${error?.message || error}`;
      status.dataset.kind = "error";
    }
  });
} catch (error) {
  console.error("[AI Chess Companion] bootstrap failed", error);
  forceVisible();
  const status = document.getElementById("status");
  if (status) {
    status.textContent = `Failed to load: ${error?.message || error}`;
    status.dataset.kind = "error";
  }
  const board = document.getElementById("board");
  if (board && !board.children.length) {
    board.textContent = "Failed to load board — see status below.";
  }
}
