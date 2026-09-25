/**
 * Shared app harness: boots the real {@link App} against the DOM/API doubles.
 * Used by app-flow, latency, battle and studio suites.
 *
 * @module test/helpers/boot-app
 */

import { installFakeChrome } from "./fake-chrome.js";
import { FakeElement, installFakeDom } from "./fake-dom.js";

/** Element ids referenced by the panel markup. */
export const ELEMENT_IDS = [
  "board",
  "status",
  "status-action",
  "turn",
  "opponent",
  "fen",
  "moves",
  "moves-empty",
  "undo",
  "new-game",
  "flip",
  "switch-side",
  "pause",
  "ask-ai",
  "copy-prompt",
  "reload-tab",
  "copy-pgn",
  "open-pgn",
  "copy-fen",
  "connections",
  "platform-select",
  "open-platform",
  "tab-list",
  "pinned-tab",
  "refresh-tabs",
  "unpin-tab",
  "match-anchor",
  "match-movetime",
  "match-engine-status",
  "match-start",
  "match-stop",
  "match-export",
  "match-estimate",
  "match-scale",
  "promotion-dialog",
  "settings-dialog",
  "settings-side",
  "settings-theme",
  "settings-prompt-style",
  "settings-fun-sentences",
  "battle-section",
  "battle-opponent-tab",
  "battle-opponent-color",
  "battle-minutes",
  "battle-increment",
  "battle-start",
  "battle-pause",
  "battle-resume",
  "battle-ask-again",
  "battle-abort",
  "battle-rematch",
  "battle-export",
  "battle-export-all",
  "battle-status",
  "battle-ledger",
  "battle-history",
  "studio-section",
  "studio-platform",
  "studio-style",
  "studio-fun-row",
  "studio-fun-sentences",
  "studio-metrics",
  "studio-budget-hint",
  "studio-preview",
  "studio-copy",
  "latency-timeline",
  "copy-timeline",
  "settings-max-retries",
  "settings-send-mode",
  "settings-generation-wait",
  "settings-sound-volume",
  "settings-clock-duration",
  "pgn-dialog",
  "pgn-text",
  "pgn-status",
  "pgn-copy",
  "pgn-load",
  "what-happened",
  "what-happened-detail",
];

/**
 * Boots the app against the DOM/API doubles.
 *
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.storage]
 * @param {object} [options.activeTab]
 * @param {object[]} [options.tabs]
 * @param {object} [options.pin]
 * @param {() => object} [options.stockfishFactory]
 * @returns {Promise<{app: import('../../src/ui/app.js').App, state: object, emitRuntimeMessage: Function, prompts: () => object[], document: object, refs: Record<string, any>, teardown: () => void}>}
 */
/** @param {number} ms */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function bootApp({ storage = {}, activeTab, tabs, pin, stockfishFactory } = {}) {
  const elements = Object.fromEntries(ELEMENT_IDS.map((id) => [id, new FakeElement("div")]));
  elements["promotion-dialog"].buttons = ["q", "r", "b", "n"].map((piece) => {
    const button = new FakeElement("button");
    button.dataset.piece = piece;
    return button;
  });
  elements["settings-dialog"].toggles = [
    "showCoordinates",
    "showLegalTargets",
    "highlightLastMove",
    "autoRetry",
    "persistGame",
  ].map((setting) => {
    const input = new FakeElement("input");
    input.dataset.setting = setting;
    input.checked = true;
    return input;
  });

  const dom = installFakeDom({ elementsById: elements });
  const fake = installFakeChrome({
    storage,
    ...(activeTab !== undefined ? { activeTab } : {}),
    ...(tabs !== undefined ? { tabs } : {}),
    ...(pin !== undefined ? { pin } : {}),
  });

  const { App } = await import("../../src/ui/app.js");
  const app = new App(
    {
      board: elements.board,
      status: elements.status,
      statusAction: elements["status-action"],
      turn: elements.turn,
      opponent: elements.opponent,
      fen: elements.fen,
      moveList: elements.moves,
      moveListEmpty: elements["moves-empty"],
      controls: {
        undo: elements.undo,
        newGame: elements["new-game"],
        flip: elements.flip,
        switchSide: elements["switch-side"],
        pause: elements.pause,
        askAi: elements["ask-ai"],
        copyPrompt: elements["copy-prompt"],
        reloadTab: elements["reload-tab"],
        copyPgn: elements["copy-pgn"],
        openPgn: elements["open-pgn"],
        copyFen: elements["copy-fen"],
        statusAction: elements["status-action"],
      },
      platformBanner: {
        root: elements.connections,
        select: elements["platform-select"],
        open: elements["open-platform"],
        list: elements["tab-list"],
        pinned: elements["pinned-tab"],
        refresh: elements["refresh-tabs"],
        unpin: elements["unpin-tab"],
      },
      battle: {
        root: elements["battle-section"],
        opponentTab: elements["battle-opponent-tab"],
        opponentColor: elements["battle-opponent-color"],
        minutes: elements["battle-minutes"],
        increment: elements["battle-increment"],
        start: elements["battle-start"],
        pause: elements["battle-pause"],
        resume: elements["battle-resume"],
        askAgain: elements["battle-ask-again"],
        abort: elements["battle-abort"],
        rematch: elements["battle-rematch"],
        export: elements["battle-export"],
        exportAll: elements["battle-export-all"],
        status: elements["battle-status"],
        ledger: elements["battle-ledger"],
        history: elements["battle-history"],
      },
      studio: {
        root: elements["studio-section"],
        platform: elements["studio-platform"],
        style: elements["studio-style"],
        funRow: elements["studio-fun-row"],
        funSentences: elements["studio-fun-sentences"],
        metrics: elements["studio-metrics"],
        budgetHint: elements["studio-budget-hint"],
        preview: elements["studio-preview"],
        copy: elements["studio-copy"],
      },
      diagnostics: {
        root: elements["diagnostics-section"],
        timeline: elements["latency-timeline"],
        copyTimeline: elements["copy-timeline"],
      },
      match: {
        anchor: elements["match-anchor"],
        movetime: elements["match-movetime"],
        engineStatus: elements["match-engine-status"],
        start: elements["match-start"],
        stop: elements["match-stop"],
        export: elements["match-export"],
        estimate: elements["match-estimate"],
        scale: elements["match-scale"],
      },
      promotionDialog: {
        root: elements["promotion-dialog"],
        buttons: elements["promotion-dialog"].buttons,
      },
      settingsDialog: {
        root: elements["settings-dialog"],
        controls: {
          side: elements["settings-side"],
          theme: elements["settings-theme"],
          promptStyle: elements["settings-prompt-style"],
          funSentences: elements["settings-fun-sentences"],
          maxRetries: elements["settings-max-retries"],
          sendMode: elements["settings-send-mode"],
          generationWait: elements["settings-generation-wait"],
          soundVolume: elements["settings-sound-volume"],
          clockDuration: elements["settings-clock-duration"],
          toggles: elements["settings-dialog"].toggles,
        },
      },
      pgnDialog: {
        root: elements["pgn-dialog"],
        textarea: elements["pgn-text"],
        status: elements["pgn-status"],
        copy: elements["pgn-copy"],
        load: elements["pgn-load"],
      },
    },
    stockfishFactory ? { stockfishFactory } : {},
  );

  await app.start();

  return {
    app,
    state: fake.state,
    emitRuntimeMessage: fake.emitRuntimeMessage,
    prompts: () => fake.state.tabMessages.filter((entry) => entry.message.type === "SEND_CHESS_PROMPT"),
    document: dom.document,
    refs: elements,
    teardown() {
      app.dispose();
      dom.restore();
      fake.restore();
    },
  };
}
