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
  "ask-ai",
  "copy-pgn",
  "open-pgn",
  "copy-fen",
  "connections",
  "platform-select",
  "open-platform",
  "promotion-dialog",
  "settings-dialog",
  "settings-side",
  "settings-theme",
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
async function bootApp({ storage = {} } = {}) {
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
  const fake = installFakeChrome({ storage });

  const { App } = await import("../src/ui/app.js");
  const app = new App({
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
      askAi: elements["ask-ai"],
      copyPgn: elements["copy-pgn"],
      openPgn: elements["open-pgn"],
      copyFen: elements["copy-fen"],
      statusAction: elements["status-action"],
    },
    platformBanner: {
      root: elements.connections,
      select: elements["platform-select"],
      open: elements["open-platform"],
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
  });

  await app.start();

  return {
    app,
    state: fake.state,
    prompts: () => fake.state.tabMessages.filter((entry) => entry.message.type === "SEND_CHESS_PROMPT"),
    document: dom.document,
    refs: elements,
    teardown() {
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
    assert.equal(env.refs["opponent"].textContent, "ChatGPT (Black)");
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
    assert.match(refs.status.textContent, /You play Black/);
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
    await app.refreshConnection();

    await app.selectSquare(12);
    await app.selectSquare(28);

    // v0.2.0 text is "No AI chat detected..." — accept either old or new wording
    assert.match(refs.status.textContent, /no AI chat (is open|detected)/i);
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

test("the status line offers a retry while the AI is thinking", async () => {
  const env = await bootApp();
  try {
    const { app, refs } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);

    assert.match(refs.status.textContent, /Waiting for ChatGPT/);
    assert.equal(refs["status-action"].dataset.action, "ask-ai");
    assert.equal(refs["status-action"].hidden, false);

    refs["status-action"].dispatch("click");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(env.prompts().length, 2, "the action re-sends the move request");
  } finally {
    env.teardown();
  }
});
