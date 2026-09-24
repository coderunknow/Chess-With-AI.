import assert from "node:assert/strict";
import test from "node:test";

import { installFakeChrome } from "./helpers/fake-chrome.js";
import { FakeElement, installFakeDom } from "./helpers/fake-dom.js";

/** Element ids referenced by the panel markup. */
const ELEMENT_IDS = [
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
];

/**
 * Boots the app against the DOM/API doubles.
 *
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.storage]
 * @returns {Promise<{app: import('../src/ui/app.js').App, state: object, document: object, teardown: () => void, refs: Record<string, any>}>}
 */
async function bootApp({ storage = {}, activeTab, tabs, pin, stockfishFactory } = {}) {
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

  const { App } = await import("../src/ui/app.js");
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

test("the app starts idle with an empty board and a live connection", async () => {
  const env = await bootApp();
  try {
    const { app } = env;

    assert.equal(app.session.plyCount, 0);
    assert.equal(app.session.playerColor, "w");
    assert.match(env.refs.status.textContent, /Your move/);
    assert.equal(env.refs["turn"].textContent, "White to move");
    assert.equal(env.refs["opponent"].textContent, "ChatGPT — Chess chat (Black)");
    // v0.2.0: refreshConnection may ping for diagnostics, but no chess prompt is sent
    assert.equal(env.prompts().length, 0, "no chess prompt is sent before the first move");
  } finally {
    env.teardown();
  }
});

test("playing a move sends exactly one prompt to the AI tab", async () => {
  const env = await bootApp();
  try {
    const { app } = env;

    await app.selectSquare(12); // e2
    await app.selectSquare(28); // e4

    assert.equal(app.session.plyCount, 1);
    assert.equal(app.session.lastMove.uci, "e2e4");
    assert.equal(env.prompts().length, 1);

    const [sent] = env.prompts();
    assert.equal(sent.tabId, 7);
    assert.equal(sent.message.type, "SEND_CHESS_PROMPT");
    assert.match(sent.message.prompt, /You are playing BLACK/);
    assert.match(sent.message.prompt, /\[e2e4\]/);
    assert.match(env.refs.status.textContent, /Waiting for ChatGPT/);
  } finally {
    env.teardown();
  }
});

test("an AI reply moves a black piece and hands the turn back", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);

    await app.handleAiMove({ move: "e7e5" });

    assert.equal(app.session.plyCount, 2);
    assert.equal(app.session.lastMove.source, "ai");
    assert.equal(app.session.isPlayerTurn, true);
    assert.match(env.refs.status.textContent, /Your move/);
  } finally {
    env.teardown();
  }
});

test("an illegal AI reply triggers a bounded automatic retry", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);
    const promptsBefore = env.prompts().length;

    await app.handleAiMove({ move: "e7e5x" });
    assert.equal(app.session.plyCount, 1, "an unreadable move is not applied");
    assert.equal(env.prompts().length, promptsBefore + 1, "a retry prompt is sent");
    assert.match(env.prompts().at(-1).message.prompt, /not legal/);

    await app.handleAiMove({ move: "a1a1" });
    assert.equal(env.prompts().length, promptsBefore + 2);

    await app.handleAiMove({ move: "h8h1" });
    assert.equal(env.prompts().length, promptsBefore + 2, "retries stop at the configured limit");
    assert.equal(app.session.retryCount, 2);
    assert.match(env.refs.status.textContent, /Ask again|not legal here/);
  } finally {
    env.teardown();
  }
});

test("repeating a rejected first reply is explained and bounded, not replaced by a later legal example", async () => {
  const env = await bootApp();
  try {
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    await env.app.handleAiMove({ move: "a1a1" });
    assert.equal(env.app.session.retryCount, 1);
    const before = env.prompts().length;
    await env.app.handleAiMove({ move: "a1a1", candidates: ["a1a1", "e7e5"] });
    assert.equal(env.app.session.plyCount, 1, "the second bracketed UCI was not the answer");
    assert.equal(env.app.session.retryCount, 2);
    assert.equal(env.prompts().length, before + 1);
    assert.match(env.prompts().at(-1).message.prompt, /already rejected in this position/);
    await env.app.handleAiMove({ move: "a1a1", repeated: true, noMove: true });
    assert.equal(env.app.session.retryCount, 2, "the maximum is never exceeded");
    assert.equal(env.prompts().length, before + 1);
    assert.match(env.refs.status.textContent, /already rejected in this position/);
  } finally {
    env.teardown();
  }
});

test("multi-move replies use the first legal candidate", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);

    await app.handleAiMove({ move: "e7e5", candidates: ["e7e5", "c7c5"] });
    assert.equal(app.session.lastMove.uci, "e7e5");
  } finally {
    env.teardown();
  }
});

test("a stale AI reply is reported and ignored", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.handleAiMove({ move: "e7e5" });

    assert.equal(app.session.plyCount, 0);
    assert.match(env.refs.status.textContent, /it is your turn/i);
  } finally {
    env.teardown();
  }
});

test("moves are rejected while the AI is thinking", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);

    await app.selectSquare(11); // d2
    await app.selectSquare(27); // d4
    assert.equal(app.session.plyCount, 1, "the human cannot move out of turn");
  } finally {
    env.teardown();
  }
});

test("undo takes back both plies and clears the waiting state", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);
    await app.handleAiMove({ move: "e7e5" });

    app.undo();

    assert.equal(app.session.plyCount, 0);
    assert.equal(app.session.isWaitingForAi, false);
    assert.match(env.refs.status.textContent, /Took back 2 plies/);
  } finally {
    env.teardown();
  }
});

test("selecting an enemy piece or an empty square explains why", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(52); // e7, black pawn
    assert.match(env.refs.status.textContent, /belongs to the AI/);

    await app.selectSquare(36); // e5, empty
    assert.match(env.refs.status.textContent, /Select one of your pieces/);
  } finally {
    env.teardown();
  }
});

test("the game is persisted and restored between sessions", async () => {
  const env = await bootApp();
  try {
    const { app, state } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);
    await app.handleAiMove({ move: "e7e5" });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const snapshot = state.storageData.game;
    assert.equal(snapshot.moves.length, 2);
  } finally {
    env.teardown();
  }

  const restored = await bootApp({
    storage: {
      game: {
        version: 1,
        initialFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        playerColor: "w",
        moves: ["e2e4", "e7e5"],
      },
      settings: { playerColor: "w" },
    },
  });
  try {
    assert.equal(restored.app.session.plyCount, 2);
    assert.equal(restored.app.session.isPlayerTurn, true);
  } finally {
    restored.teardown();
  }
});

test("changing sides starts a new game and flips the board", async () => {
  const env = await bootApp();
  try {
    const { app, refs } = env;
    await app.updateSettings({ playerColor: "b" });

    assert.equal(app.session.playerColor, "b");
    assert.equal(app.session.plyCount, 0);
    assert.equal(app.session.isWaitingForAi, true, "the AI opens as White");
    assert.equal(refs.board.dataset.flipped, "true");
    assert.match(refs.status.textContent, /play Black/);
  } finally {
    env.teardown();
  }
});

test("the panel asks the AI to open when the human plays Black", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.updateSettings({ playerColor: "b" });
    await app.requestAiMove();

    assert.equal(env.prompts().length, 1);
    assert.match(env.prompts()[0].message.prompt, /Let's play chess/);
    assert.equal(app.session.isWaitingForAi, true);
  } finally {
    env.teardown();
  }
});

test("a nonstandard Black-to-move FEN preserves its move number in prompts and history", async () => {
  const env = await bootApp();
  try {
    env.app.session.reset({ playerColor: "w", initialFen: "r3k3/8/8/8/8/8/8/4K3 b - - 0 42" });
    await env.app.handleAiMove({ move: "a8a7" });
    assert.equal(env.app.session.moveListText, "42... Ra7");
    assert.equal(env.refs.moves.children[0].children[0].textContent, "42.");
    assert.equal(env.app.session.history[0].color, "b");
  } finally {
    env.teardown();
  }
});

test("PGN export reflects the played moves", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);
    await app.handleAiMove({ move: "e7e5" });

    const pgn = app.toPgn();
    assert.match(pgn, /1\. e4 e5/);
    assert.match(pgn, /\[Result "\*"\]/);
  } finally {
    env.teardown();
  }
});

test("loading a PGN replaces the game and reports problems", async () => {
  const env = await bootApp();
  try {
    const { app, refs } = env;

    const ok = app.loadPgn("1. e4 e5 2. Nf3 Nc6 *");
    assert.equal(ok.ok, true);
    assert.equal(app.session.plyCount, 4);

    refs["pgn-text"].value = "1. e4 e5 2. Qh9 *";
    refs["pgn-load"].dispatch("click");
    assert.equal(app.session.plyCount, 2, "the readable prefix is loaded");
    assert.match(refs["pgn-status"].textContent, /Qh9/);
  } finally {
    env.teardown();
  }
});

test("a finished game blocks further moves and offers a new game", async () => {
  const env = await bootApp();
  try {
    const { app, refs } = env;
    app.loadPgn("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0");

    assert.equal(app.session.isGameOver, true);
    assert.match(refs.status.textContent, /Checkmate/);
    assert.equal(refs["status-action"].dataset.action, "new-game");
    assert.equal(refs["status-action"].hidden, false);

    await app.selectSquare(8); // a2: the board is frozen once the game is over
    assert.equal(app.session.plyCount, 7);
    assert.match(refs.status.textContent, /Checkmate/);
  } finally {
    env.teardown();
  }
});

test("promotion asks for a piece and plays the choice", async () => {
  const env = await bootApp();
  try {
    const { app, refs } = env;
    const pawnOnE7 = "8/4P3/8/8/8/8/8/4K2k w - - 0 1";

    app.session.reset({ initialFen: pawnOnE7 });
    await app.selectSquare(52); // e7

    const promotion = app.selectSquare(60); // e8 opens the chooser
    assert.equal(refs["promotion-dialog"].open, true, "the chooser is modal");

    // A real click bubbles from the button up to the dialog, which is where the handler lives.
    const choice = refs["promotion-dialog"].buttons.find((button) => button.dataset.piece === "n");
    refs["promotion-dialog"].dispatch("click", { target: choice });
    await promotion;

    assert.equal(app.session.lastMove.uci, "e7e8n");
    assert.equal(app.session.position.pieceAt(60), "N");
    assert.equal(refs["promotion-dialog"].open, false, "the chooser closes itself");
  } finally {
    env.teardown();
  }
});

test("confirming an old promotion after a new game cannot play a move on the reset board", async () => {
  const env = await bootApp();
  try {
    const { app, refs } = env;
    app.session.reset({ initialFen: "8/4P3/8/8/8/8/8/4K2k w - - 0 1" });
    await app.selectSquare(52);
    const pending = app.selectSquare(60);
    assert.equal(refs["promotion-dialog"].open, true);
    app.resetGame();
    const choice = refs["promotion-dialog"].buttons.find((button) => button.dataset.piece === "q");
    refs["promotion-dialog"].dispatch("click", { target: choice });
    await pending;
    assert.equal(app.session.plyCount, 0);
    assert.equal(app.session.position.pieceAt(60), "k", "the new game has its original pieces");
    assert.equal(env.prompts().length, 0, "a stale promotion never dispatches a prompt");
  } finally {
    env.teardown();
  }
});

test("cancelling the promotion chooser leaves the position untouched", async () => {
  const env = await bootApp();
  try {
    const { app, refs } = env;
    app.session.reset({ initialFen: "8/4P3/8/8/8/8/8/4K2k w - - 0 1" });
    await app.selectSquare(52);

    const promotion = app.selectSquare(60);
    refs["promotion-dialog"].dispatch("cancel", { target: refs["promotion-dialog"] });
    await promotion;

    assert.equal(app.session.plyCount, 0);
    assert.match(refs.status.textContent, /Promotion cancelled/);
  } finally {
    env.teardown();
  }
});

test("copying the PGN uses the clipboard and confirms it", async () => {
  const env = await bootApp();
  try {
    const { app, refs, document: doc } = env;
    app.loadPgn("1. e4 e5 *");
    refs["copy-pgn"].dispatch("click");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.match(doc.lastCopiedText, /1\. e4 e5/);
    assert.match(refs.status.textContent, /PGN copied/);
  } finally {
    env.teardown();
  }
});

test("status line offers an action when no AI tab is open", async () => {
  const env = await bootApp();
  try {
    const { app, refs, state } = env;
    state.activeTab = null;
    state.tabs = []; // the pinned tab was closed; focus cannot retarget the prompt
    await app.refreshConnection();

    await app.selectSquare(12);
    await app.selectSquare(28);

    // v0.2.0 text is "No AI chat detected..." — accept either old or new wording
    assert.match(refs.status.textContent, /pin one supported AI tab/i);
    assert.equal(refs["status-action"].dataset.action, "open-ai");
    assert.equal(app.session.plyCount, 1);
    assert.equal(env.prompts().length, 0, "nothing can be sent without an AI tab");
  } finally {
    env.teardown();
  }
});

test("the panel tolerates a missing content script by injecting it", async () => {
  const env = await bootApp();
  try {
    const { app, state } = env;
    state.tabReply.failure = null;
    const originalSend = chrome.tabs.sendMessage;
    let first = true;
    chrome.tabs.sendMessage = async (tabId, message) => {
      if (message.type === "PING" && first) {
        first = false;
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }
      return originalSend(tabId, message);
    };

    await app.selectSquare(12);
    await app.selectSquare(28);

    assert.ok(state.injectedFiles.includes("src/content/index.js"));
  } finally {
    env.teardown();
  }
});

test("a cold bootstrap waits for its listener and sends exactly one prompt", async () => {
  const env = await bootApp();
  const originalSend = chrome.tabs.sendMessage;
  let pings = 0;
  try {
    chrome.tabs.sendMessage = (tabId, message) => {
      if (message.type === "PING" && ++pings < 4) {
        throw new Error("The dynamic import has not installed its listener yet.");
      }
      return originalSend(tabId, message);
    };
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    assert.ok(env.state.injectedFiles.includes("src/content/index.js"));
    assert.equal(pings, 4);
    assert.equal(env.prompts().length, 1, "only PING may be retried");
  } finally {
    chrome.tabs.sendMessage = originalSend;
    env.teardown();
  }
});

test("a navigation between pin validation and bridge PING never sends a prompt", async () => {
  const env = await bootApp();
  const originalSend = chrome.tabs.sendMessage;
  try {
    chrome.tabs.sendMessage = (tabId, message) => {
      if (message.type === "PING") {
        return { ok: true, url: "https://claude.ai/new", platform: "claude" };
      }
      return originalSend(tabId, message);
    };
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    assert.equal(env.prompts().length, 0);
    assert.match(env.refs.status.textContent, /navigated/i);
    assert.equal(env.state.injectedFiles.length, 0);
  } finally {
    chrome.tabs.sendMessage = originalSend;
    env.teardown();
  }
});

test("an unanswered one-shot prompt cannot be resubmitted from the status or Ask AI controls", async () => {
  const env = await bootApp();
  try {
    const { app, refs } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);

    assert.match(refs.status.textContent, /Waiting for ChatGPT/);
    assert.equal(refs["status-action"].hidden, true);
    assert.equal(refs["ask-ai"].hidden, true);
    refs["status-action"].dispatch("click");
    await app.requestAiMove();
    assert.equal(env.prompts().length, 1, "neither control can submit a duplicate while awaiting");
  } finally {
    env.teardown();
  }
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, limit = 1500) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(5);
  }
  assert.ok(predicate(), "expected asynchronous state change did not occur");
}

test("a pin ignores focus changes and addresses prompts only to the chosen chat", async () => {
  const env = await bootApp({
    tabs: [
      { id: 7, url: "https://chatgpt.com/c/1", titleFromContent: "Pinned conversation" },
      { id: 8, url: "https://claude.ai/chat/2", titleFromContent: "Focused conversation" },
      { id: 9, url: "https://example.org/", titleFromContent: "Never list me" },
    ],
  });
  try {
    assert.equal(env.refs["tab-list"].children.length, 2, "only supported hosts appear in the picker");
    assert.match(env.refs.opponent.textContent, /Pinned conversation/);
    env.state.activeTab = { tabId: 8, supported: true, url: "https://claude.ai/chat/2" };
    env.emitRuntimeMessage({ type: "ACTIVE_TAB_CHANGED", tabId: 8, url: "https://claude.ai/chat/2", supported: true });
    await env.app.refreshConnection();
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    assert.equal(env.prompts().at(-1).tabId, 7);
    assert.match(env.refs.opponent.textContent, /Pinned conversation/);
    await env.app.pinTab(8);
    assert.match(env.refs.opponent.textContent, /Focused conversation/);
    await env.app.requestAiMove();
    assert.equal(env.prompts().at(-1).tabId, 8);
  } finally {
    env.teardown();
  }
});

test("a stale tab-list response cannot restore an old pin after explicit unpin", async () => {
  const env = await bootApp();
  const original = chrome.runtime.sendMessage;
  let answerOldList;
  try {
    chrome.runtime.sendMessage = (message) =>
      message.type === "GET_CONNECTIONS" && !answerOldList
        ? new Promise((resolve) => {
            answerOldList = resolve;
          })
        : original(message);
    const pending = env.app.refreshConnection();
    await until(() => Boolean(answerOldList));
    await env.app.unpinTab();
    answerOldList({
      ok: true,
      pin: { tabId: 7, url: "https://chatgpt.com/c/1", platformId: "chatgpt", title: "Old" },
      tabs: [],
    });
    await pending;
    assert.equal(env.refs["pinned-tab"].textContent.includes("Old"), false);
    assert.equal(env.state.sessionData.pinnedAiTab, undefined);
    assert.match(env.refs["pinned-tab"].textContent, /Choose and pin one supported AI tab/);
  } finally {
    chrome.runtime.sendMessage = original;
    env.teardown();
  }
});

test("closed or unsupported pinned tab clears the pin without silently retargeting", async () => {
  const env = await bootApp({
    tabs: [
      { id: 7, url: "https://chatgpt.com/c/1", titleFromContent: "Pinned" },
      { id: 8, url: "https://claude.ai/chat", titleFromContent: "Focused" },
    ],
  });
  try {
    env.state.activeTab = { tabId: 8, supported: true, url: "https://claude.ai/chat" };
    env.state.tabs[0].url = "https://example.org/";
    await env.app.refreshConnection();
    assert.match(env.refs.status.textContent, /pinned AI tab closed|pin one supported AI tab/i);
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    assert.equal(env.prompts().length, 0);
    assert.equal(env.state.sessionData.pinnedAiTab, undefined);
  } finally {
    env.teardown();
  }
});

test("pause persists, stops dispatch and never unregisters content scripts", async () => {
  const env = await bootApp();
  try {
    await env.app.updateSettings({ paused: true });
    assert.equal(env.state.storageData.settings.paused, true);
    assert.equal(env.refs.pause.textContent, "Resume");
    assert.ok(env.state.tabMessages.some(({ message }) => message.type === "SET_PAUSED" && message.paused));
    await env.app.selectSquare(12);
    assert.equal(env.app.session.plyCount, 0, "the board is idle while paused");
    await env.app.requestAiMove();
    assert.equal(env.prompts().length, 0);
    assert.ok(!env.state.runtimeMessages.some((message) => message.type === "UNREGISTER_CONTENT_SCRIPTS"));
    await env.app.updateSettings({ paused: false });
    assert.equal(env.refs.pause.textContent, "Pause");
    assert.equal(env.prompts().length, 0, "resume does not re-send or rescan history");
  } finally {
    env.teardown();
  }
});

test("pausing during a delayed content-script ping cancels the send before any prompt reaches the tab", async () => {
  const env = await bootApp();
  const originalSend = chrome.tabs.sendMessage;
  let releasePing;
  let pingStarted = false;
  try {
    chrome.tabs.sendMessage = (tabId, message) => {
      if (message.type === "PING" && !pingStarted) {
        pingStarted = true;
        return new Promise((resolve) => {
          releasePing = () => resolve(originalSend(tabId, message));
        });
      }
      return originalSend(tabId, message);
    };
    await env.app.selectSquare(12);
    const pending = env.app.selectSquare(28);
    await until(() => pingStarted);
    await env.app.updateSettings({ paused: true });
    releasePing();
    await pending;
    assert.equal(env.prompts().length, 0, "a cancelled request must not leak through the delayed ping");
    assert.match(env.refs.status.textContent, /paused/i);
    chrome.tabs.sendMessage = originalSend;
    await env.app.updateSettings({ paused: false });
    await env.app.requestAiMove();
    assert.equal(env.prompts().length, 1, "a later intentional request works after cancellation");
  } finally {
    chrome.tabs.sendMessage = originalSend;
    env.teardown();
  }
});

test("a delayed failed send cannot overwrite the unpinned status or retarget to the focused tab", async () => {
  const env = await bootApp();
  const originalSend = chrome.tabs.sendMessage;
  let releaseSend;
  try {
    chrome.tabs.sendMessage = (tabId, message) => {
      if (message.type === "SEND_CHESS_PROMPT") {
        env.state.tabMessages.push({ tabId, message });
        return new Promise((resolve) => {
          releaseSend = resolve;
        });
      }
      return originalSend(tabId, message);
    };
    await env.app.selectSquare(12);
    const pending = env.app.selectSquare(28);
    await until(() => Boolean(releaseSend));
    await env.app.unpinTab();
    releaseSend({ ok: false, result: "submit-failed", error: "Old tab failed" });
    await pending;
    assert.match(env.refs.status.textContent, /unpinned/i);
    assert.doesNotMatch(env.refs.status.textContent, /Old tab failed/);
    assert.equal(env.prompts().length, 1);
    assert.equal(env.state.sessionData.pinnedAiTab, undefined);
  } finally {
    chrome.tabs.sendMessage = originalSend;
    env.teardown();
  }
});

test("manual mode copies/offers the prompt without an automatic send keystroke", async () => {
  const env = await bootApp({ storage: { settings: { sendMode: "manual" } } });
  try {
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    assert.equal(env.prompts().length, 1, "the pinned content watcher still receives the request");
    assert.match(env.refs.status.textContent, /Paste and send it yourself/i);
    assert.equal(env.refs["copy-prompt"].hidden, false);
    assert.equal(env.state.tabMessages.at(-1).message.type, "SEND_CHESS_PROMPT");
  } finally {
    env.teardown();
  }
});

test("switch-side toolbar action confirms a new game after moves and flips Black", async () => {
  const env = await bootApp();
  const oldConfirm = globalThis.confirm;
  try {
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    globalThis.confirm = () => false;
    assert.equal(await env.app.switchSide("b"), false);
    assert.equal(env.app.session.plyCount, 1);
    assert.equal(env.app.playerColor, "w");
    globalThis.confirm = () => true;
    assert.equal(await env.app.switchSide("b"), true);
    assert.equal(env.app.session.plyCount, 0);
    assert.equal(env.app.playerColor, "b");
    assert.equal(env.refs.board.dataset.flipped, "true");
    assert.equal(env.refs["switch-side"].textContent, "Play White");
  } finally {
    globalThis.confirm = oldConfirm;
    env.teardown();
  }
});

function stockfishStub(moves) {
  return {
    ready: false,
    range: null,
    searches: [],
    newGames: [],
    async boot() {
      this.ready = true;
      this.range = { min: 1320, max: 3190 };
      return this.range;
    },
    async newGame(elo) {
      this.newGames.push(elo);
      return elo;
    },
    async search(fen, elo, movetime) {
      this.searches.push({ fen, elo, movetime });
      return moves.shift() || "a1a1";
    },
    stop() {
      this.ready = false;
      this.range = null;
    },
  };
}

test("rated Elo controls stay blank until the worker reports its range", async () => {
  const engine = {
    ready: false,
    async boot() {
      this.ready = true;
      return { min: 2000, max: 2500 };
    },
    stop() {
      this.ready = false;
    },
  };
  const env = await bootApp({ storage: { settings: { paused: true } }, stockfishFactory: () => engine });
  try {
    const anchor = env.refs["match-anchor"];
    assert.equal(anchor.disabled, true);
    assert.equal(anchor.value, "");
    assert.equal(anchor.min, "");
    assert.equal(anchor.max, "");
    await env.app.updateSettings({ paused: false });
    await until(() => anchor.value === "2000");
    assert.equal(anchor.min, "2000");
    assert.equal(anchor.max, "2500");
    assert.equal(anchor.disabled, false);
    assert.match(env.refs["match-engine-status"].textContent, /2000.*2500/);
  } finally {
    env.teardown();
  }
});

test("rated result follows real Stockfish moves and parsed replies from the pinned tab", async () => {
  const engine = stockfishStub(["e7e5", "d8h4", "e2e4"]);
  const env = await bootApp({ stockfishFactory: () => engine });
  const oldConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  const reply = async (move) => {
    const prompt = env.prompts().at(-1);
    env.emitRuntimeMessage(
      { type: "AI_MOVE", move, candidates: [move], requestId: prompt.message.requestId, platform: "chatgpt" },
      { tab: { id: 7 } },
    );
    await delay(15);
  };
  try {
    await until(() => engine.ready && env.refs["match-start"].disabled === false);
    assert.equal(await env.app.startRatedMatch(), true);
    assert.equal(env.app.session.playerColor, "b", "Stockfish owns Black, chat AI owns White");
    assert.equal(env.prompts().length, 1);
    // A response from a different tab (or request ID) cannot become a rated move.
    const id = env.prompts().at(-1).message.requestId;
    env.emitRuntimeMessage({ type: "AI_MOVE", move: "f2f3", requestId: id }, { tab: { id: 8 } });
    env.emitRuntimeMessage({ type: "AI_MOVE", move: "f2f3", requestId: id + 1 }, { tab: { id: 7 } });
    assert.equal(env.app.session.plyCount, 0);
    await reply("f2f3");
    await until(() => env.prompts().length === 2);
    assert.equal(env.app.session.history[1].uci, "e7e5");
    await reply("g2g4");
    await until(() => env.state.storageData.ratedMatches?.games?.length === 1);
    const saved = env.state.storageData.ratedMatches.games[0];
    assert.equal(saved.result, "0-1", "Fool's mate is a real checkmate, not a scripted score");
    assert.equal(saved.aiColor, "w");
    assert.equal(saved.anchorElo, 1500);
    assert.equal(saved.stockfishMoves, 2);
    assert.equal(saved.chatMoves, 2);
    assert.match(saved.pgn, /Chat AI \(chatgpt\)/);
    assert.match(saved.pgn, /Stockfish UCI_Elo 1500/);
    assert.match(env.refs["match-estimate"].textContent, /1 games .*W–D–L 0–0–1.*95% interval.*provisional/);
    assert.equal(env.refs["match-scale"].textContent, "Stockfish UCI_Elo scale, not FIDE");
    assert.equal(engine.searches.length, 2);
    assert.ok(engine.searches.every((request) => request.elo === 1500 && request.movetime === 500));
    assert.equal(await env.app.startRatedMatch(), true);
    assert.equal(env.app.session.playerColor, "w", "chat AI is Black in the next rated game");
    assert.equal(env.app.session.lastMove.uci, "e2e4", "Stockfish plays White from the engine slot");
    env.app.stopRatedMatch();
    assert.equal(env.state.storageData.ratedMatches.games.length, 1, "stopping is unrated");
  } finally {
    globalThis.confirm = oldConfirm;
    env.teardown();
  }
});

test("a finished rated game cannot be stopped or replaced while its result is being saved", async () => {
  const engine = stockfishStub(["e7e5", "d8h4", "e2e4"]);
  const env = await bootApp({ stockfishFactory: () => engine });
  const originalSet = chrome.storage.local.set;
  const originalConfirm = globalThis.confirm;
  let releaseSave;
  globalThis.confirm = () => true;
  chrome.storage.local.set = async (values) => {
    if (values.ratedMatches)
      await new Promise((resolve) => {
        releaseSave = resolve;
      });
    return originalSet(values);
  };
  try {
    await until(() => engine.ready);
    assert.equal(await env.app.startRatedMatch(), true);
    for (const move of ["f2f3", "g2g4"]) {
      const prompt = env.prompts().at(-1).message;
      env.emitRuntimeMessage({ type: "AI_MOVE", move, requestId: prompt.requestId }, { tab: { id: 7 } });
      await until(() => (move === "f2f3" ? env.prompts().length === 2 : Boolean(releaseSave)));
    }
    assert.equal(env.app.session.outcome.reason, "checkmate");
    assert.equal(env.refs["match-start"].disabled, true);
    assert.equal(env.refs["match-stop"].hidden, true);
    assert.equal(await env.app.startRatedMatch(), false, "a new match must wait for the old result to persist");
    env.app.stopRatedMatch(); // even a late programmatic Stop cannot discard a completed game
    assert.equal(env.state.storageData.ratedMatches, undefined);
    env.app.resetGame(); // a new board while storage is slow must retain its own status
    assert.equal(env.app.session.plyCount, 0);
    releaseSave();
    await until(
      () =>
        env.state.storageData.ratedMatches?.games?.length === 1 && /W–D–L/.test(env.refs["match-estimate"].textContent),
    );
    assert.equal(env.state.storageData.ratedMatches.games[0].result, "0-1");
    assert.match(env.refs.status.textContent, /New game/);
    assert.doesNotMatch(env.refs.status.textContent, /Rated game finished/);
    assert.equal(await env.app.startRatedMatch(), true);
    assert.equal(env.app.session.playerColor, "w", "completion, not Stop, advances colour alternation");
    env.app.stopRatedMatch();
  } finally {
    releaseSave?.();
    chrome.storage.local.set = originalSet;
    globalThis.confirm = originalConfirm;
    env.teardown();
  }
});

test("a stopped match's delayed newGame cannot advance its replacement or send a duplicate prompt", async () => {
  const engine = stockfishStub([]);
  const originalNewGame = engine.newGame.bind(engine);
  let releaseFirst;
  engine.newGame = async (elo) => {
    await originalNewGame(elo);
    if (engine.newGames.length === 1)
      return new Promise((resolve) => {
        releaseFirst = () => resolve(elo);
      });
    return elo;
  };
  const env = await bootApp({ stockfishFactory: () => engine });
  const oldConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    await until(() => engine.ready);
    const first = env.app.startRatedMatch();
    await until(() => Boolean(releaseFirst));
    env.app.stopRatedMatch();
    await until(() => engine.ready && env.refs["match-start"].disabled === false);
    const second = await env.app.startRatedMatch();
    assert.equal(second, true);
    assert.equal(env.prompts().length, 1);
    releaseFirst();
    assert.equal(await first, false);
    assert.equal(env.prompts().length, 1, "only the current match may advance");
    assert.equal(env.state.storageData.ratedMatches, undefined);
  } finally {
    globalThis.confirm = oldConfirm;
    env.teardown();
  }
});

test("a real threefold draw from both sides' moves is saved as a draw, not a protocol loss", async () => {
  const engine = stockfishStub(["g8f6", "f6g8", "g8f6", "f6g8"]);
  const env = await bootApp({ stockfishFactory: () => engine });
  const oldConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    await until(() => engine.ready);
    assert.equal(await env.app.startRatedMatch(), true);
    for (const move of ["g1f3", "f3g1", "g1f3", "f3g1"]) {
      await until(() => env.prompts().length === engine.searches.length + 1);
      const prompt = env.prompts().at(-1).message;
      env.emitRuntimeMessage({ type: "AI_MOVE", move, requestId: prompt.requestId }, { tab: { id: 7 } });
      await until(
        () =>
          env.app.session.lastMove?.uci === (move === "f3g1" ? "f6g8" : "g8f6") ||
          env.state.storageData.ratedMatches?.games?.length === 1,
      );
    }
    await until(() => env.state.storageData.ratedMatches?.games?.length === 1);
    const saved = env.state.storageData.ratedMatches.games[0];
    assert.equal(env.app.session.outcome.reason, "threefold-repetition");
    assert.equal(saved.result, "1/2-1/2");
    assert.equal(saved.stockfishMoves, 4);
    assert.equal(saved.chatMoves, 4);
    assert.match(saved.pgn, /1\/2-1\/2/);
    assert.match(env.refs["match-estimate"].textContent, /W–D–L 0–1–0/);
    assert.equal(engine.searches.length, 4);
  } finally {
    globalThis.confirm = oldConfirm;
    env.teardown();
  }
});

test("rated matches require Auto and a live pin; an illegal Stockfish bestmove aborts unrated", async () => {
  const engine = stockfishStub(["a1a1", "a1a1"]);
  const env = await bootApp({ stockfishFactory: () => engine });
  const oldConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    await until(() => engine.ready);
    await env.app.updateSettings({ sendMode: "manual" });
    assert.equal(await env.app.startRatedMatch(), false);
    assert.equal(env.prompts().length, 0);
    await env.app.updateSettings({ sendMode: "auto" });
    await env.app.unpinTab();
    assert.equal(await env.app.startRatedMatch(), false);
    await env.app.pinTab(7);
    assert.equal(await env.app.startRatedMatch(), true); // AI White; needs a real reply first
    const prompt = env.prompts().at(-1);
    env.emitRuntimeMessage({ type: "AI_MOVE", move: "f2f3", requestId: prompt.message.requestId }, { tab: { id: 7 } });
    await until(() => engine.searches.length === 2);
    assert.equal(env.state.storageData.ratedMatches, undefined);
    assert.match(env.refs.status.textContent, /Stockfish unavailable|illegal moves/i);
  } finally {
    globalThis.confirm = oldConfirm;
    env.teardown();
  }
});
