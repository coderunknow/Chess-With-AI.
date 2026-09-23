import assert from "node:assert/strict";
import test from "node:test";

import { START_FEN } from "../src/core/fen.js";
import { parseSquare } from "../src/core/squares.js";
import { GameSession, MoveError, MoveSource, SNAPSHOT_VERSION } from "../src/ui/game.js";

/** Scholar's mate, played by the human as White. */
const SCHOLARS_MATE = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];

/**
 * @param {string[]} moves alternating human/AI moves.
 * @param {object} [options]
 * @returns {GameSession}
 */
function playSequence(moves, options = {}) {
  const session = new GameSession(options);
  moves.forEach((uci, index) => {
    const result = index % 2 === 0 ? session.playHumanMove(uci) : session.playAiMove(uci);
    assert.ok(result.ok, `move ${index + 1} (${uci}) failed: ${result.error}`);
  });
  return session;
}

test("a fresh session starts on the player's turn", () => {
  const session = new GameSession();
  assert.equal(session.turn, "w");
  assert.equal(session.playerColor, "w");
  assert.equal(session.aiColor, "b");
  assert.equal(session.isPlayerTurn, true);
  assert.equal(session.isWaitingForAi, false);
  assert.equal(session.plyCount, 0);
  assert.equal(session.fen, START_FEN);
  assert.equal(session.isGameOver, false);
});

test("when the player takes Black the AI is asked to move first", () => {
  const session = new GameSession({ playerColor: "b" });
  assert.equal(session.isPlayerTurn, false);
  assert.equal(session.isWaitingForAi, true);
  assert.equal(session.aiColor, "w");
});

test("human and AI moves alternate and produce history entries", () => {
  const session = new GameSession();
  const human = session.playHumanMove("e2e4");

  assert.ok(human.ok);
  assert.equal(human.entry.san, "e4");
  assert.equal(human.entry.from, "e2");
  assert.equal(human.entry.color, "w");
  assert.equal(human.entry.source, MoveSource.HUMAN);
  assert.equal(session.isWaitingForAi, true);
  assert.equal(session.isPlayerTurn, false);
  assert.equal(session.moveListText, "1. e4");

  const ai = session.playAiMove("e7e5");
  assert.ok(ai.ok);
  assert.equal(ai.entry.san, "e5");
  assert.equal(ai.entry.source, MoveSource.AI);
  assert.equal(session.isPlayerTurn, true);
  assert.equal(session.isWaitingForAi, false);
  assert.equal(session.moveListText, "1. e4 e5");
  assert.equal(session.plyCount, 2);
});

test("moves out of turn are rejected with a machine-readable code", () => {
  const session = new GameSession();
  assert.equal(session.playAiMove("e7e5").code, MoveError.NOT_AI_TURN);
  session.playHumanMove("e2e4");
  assert.equal(session.playHumanMove("d2d4").code, MoveError.NOT_YOUR_TURN);
  assert.equal(session.plyCount, 1);
});

test("illegal and malformed moves never change the position", () => {
  const session = new GameSession();
  const before = session.fen;

  for (const uci of ["e2e5", "e2e4x", "", "zz99", null, undefined, 42]) {
    const result = session.playHumanMove(uci);
    assert.equal(result.ok, false, `${uci} should be rejected`);
    assert.equal(result.code, MoveError.ILLEGAL);
  }
  assert.equal(session.fen, before);
  assert.equal(session.plyCount, 0);
});

test("the AI's move may be any of several candidates", () => {
  const session = new GameSession();
  session.playHumanMove("e2e4");

  const first = session.playFirstAvailable(["e7e5", "c7c5"]);
  assert.ok(first.ok);
  assert.equal(first.entry.uci, "e7e5");

  session.playHumanMove("g1f3");
  const second = session.playFirstAvailable(["g8g4", "g8f6"]);
  assert.ok(second.ok, "the first illegal candidate is skipped");
  assert.equal(second.entry.uci, "g8f6");
  assert.deepEqual(session.rejectedMoves, ["g8g4"]);
});

test("rejected candidates are not retried for the same turn", () => {
  const session = new GameSession();
  session.playHumanMove("e2e4");
  session.playFirstAvailable(["e7e5"]);
  session.playHumanMove("g1f3");
  session.playFirstAvailable(["a1a2"]);

  const retry = session.playFirstAvailable(["a1a2", "g8f6"]);
  assert.ok(retry.ok);
  assert.equal(retry.entry.uci, "g8f6");
});

test("candidate lists with no usable move report illegal", () => {
  const session = new GameSession();
  session.playHumanMove("e2e4");
  const result = session.playFirstAvailable(["a1a2", "h1h9", "nonsense"]);
  assert.equal(result.ok, false);
  assert.equal(result.code, MoveError.ILLEGAL);
  assert.equal(session.isWaitingForAi, true, "the AI still owes a move");
});

test("checkmate ends the game and blocks further moves", () => {
  const session = playSequence(SCHOLARS_MATE);
  const outcome = session.outcome;

  assert.equal(outcome.over, true);
  assert.equal(outcome.reason, "checkmate");
  assert.equal(outcome.winner, "w");
  assert.equal(session.result, "1-0");
  assert.equal(session.lastMove.mate, true);
  assert.equal(session.isGameOver, true);

  const blocked = session.playHumanMove("a2a3");
  assert.equal(blocked.code, MoveError.GAME_OVER);
  assert.equal(session.playAiMove("a7a6").code, MoveError.GAME_OVER);
});

test("the check flag is exposed for the view", () => {
  const session = playSequence(["e2e4", "e7e5", "d1h5", "b8c6", "h5f7"]);

  assert.equal(session.isCheck, true, "Qxf7 gives check");
  assert.equal(session.isGameOver, false, "the king can capture the queen");
  assert.equal(session.lastMove.check, true);
  assert.equal(session.lastMove.mate, false);
  assert.equal(session.turn, "b", "Black must answer the check");
});

test("undo removes the AI reply together with the human move", () => {
  const session = playSequence(["e2e4", "e7e5", "g1f3", "g8f6"]);
  const undone = session.undo();

  assert.ok(undone.ok);
  assert.equal(undone.plies, 2);
  assert.equal(session.plyCount, 2);
  assert.equal(session.isPlayerTurn, true);
  assert.equal(session.lastMove.san, "e5");

  const again = session.undo();
  assert.equal(again.plies, 2);
  assert.equal(session.plyCount, 0);
  assert.equal(session.fen, START_FEN);
  assert.equal(session.undo().ok, false, "nothing left to undo");
});

test("undo after a human move also waits for the human again", () => {
  const session = new GameSession();
  session.playHumanMove("e2e4");
  const undone = session.undo();
  assert.equal(undone.plies, 1);
  assert.equal(session.isWaitingForAi, false);
  assert.equal(session.isPlayerTurn, true);
});

test("reset clears the game and can switch sides", () => {
  const session = playSequence(["e2e4", "e7e5"]);
  session.registerRetry();
  session.reset({ playerColor: "b" });

  assert.equal(session.fen, START_FEN);
  assert.equal(session.plyCount, 0);
  assert.equal(session.playerColor, "b");
  assert.equal(session.isWaitingForAi, true, "the AI opens as White");
  assert.equal(session.retryCount, 0);
});

test("retry accounting tracks prompts sent for one move", () => {
  const session = new GameSession();
  session.playHumanMove("e2e4");
  assert.equal(session.retryCount, 0);
  session.registerRetry();
  assert.equal(session.retryCount, 1);
  session.registerRetry();
  assert.equal(session.retryCount, 2);
  session.playAiMove("e7e5");
  assert.equal(session.retryCount, 0, "a successful reply clears the counter");
});

test("promotions are played with the chosen piece", () => {
  const session = new GameSession({ initialFen: "8/4P3/8/8/8/8/8/4K2k w - - 0 1" });
  const result = session.playHumanMove("e7e8n");

  assert.ok(result.ok);
  assert.equal(result.entry.promotion, "n");
  assert.equal(result.entry.san, "e8=N");
  assert.equal(session.position.pieceAt(parseSquare("e8")), "N");
});

test("snapshots round-trip through storage", () => {
  const session = playSequence(["e2e4", "e7e5", "g1f3"]);
  const snapshot = session.snapshot();

  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.deepEqual(snapshot.moves, ["e2e4", "e7e5", "g1f3"]);

  const restored = GameSession.fromSnapshot(snapshot);
  assert.equal(restored.fen, session.fen);
  assert.equal(restored.plyCount, 3);
  assert.equal(restored.isWaitingForAi, true);
  assert.equal(restored.moveListText, session.moveListText);
});

test("corrupt snapshots degrade to a fresh game", () => {
  for (const snapshot of [
    null,
    undefined,
    "nonsense",
    {},
    { version: 99, moves: [] },
    { version: SNAPSHOT_VERSION, moves: ["e2e4", "e2e5"] },
    { version: SNAPSHOT_VERSION, moves: ["e2e4", "e2e5", "bogus"], initialFen: START_FEN },
  ]) {
    const session = GameSession.fromSnapshot(snapshot, { playerColor: "w" });
    assert.equal(session.playerColor, "w");
    assert.ok(session.plyCount <= 1, "a broken snapshot never restores a corrupt game");
  }
});

test("PGN import and export round-trip", () => {
  const session = playSequence(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]);
  const pgn = session.toPgn();

  assert.match(pgn, /^\[Event "Casual game"\]$/m);
  assert.match(pgn, /1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6/);
  assert.match(pgn, /\[White "Human"\]/);
  assert.match(pgn, /\[Black "AI"\]/);

  const restored = new GameSession();
  const loaded = restored.loadPgn(pgn);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.plies, 6);
  assert.equal(restored.fen, session.fen);
  assert.equal(restored.history[0].source, MoveSource.IMPORT);
});

test("PGN import reports unusable input", () => {
  const session = new GameSession();
  assert.equal(session.loadPgn("").ok, false);
  assert.equal(session.loadPgn("1. e4 e5 2. Qh9").plies, 2, "the valid prefix is imported");
  assert.equal(session.plyCount, 2);
});

test("loading an imported game asks the AI to move when it is its turn", () => {
  const session = new GameSession({ playerColor: "w" });
  const loaded = session.loadPgn('[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"]\n\n1... e5 *');
  assert.equal(loaded.ok, true);
  assert.equal(session.turn, "w");
  assert.equal(session.isWaitingForAi, false, "it is the human's turn again");
});

test("move list and legal targets describe the position for the view", () => {
  const session = new GameSession();
  assert.deepEqual(session.legalTargets(parseSquare("e2")).sort(), ["e3", "e4"]);
  assert.equal(session.canSelect(parseSquare("e2")), true);
  assert.equal(session.canSelect(parseSquare("e7")), false);
  assert.equal(session.canSelect(parseSquare("d4")), false, "empty squares cannot be selected");
  assert.equal(session.moveListText, "");
});
