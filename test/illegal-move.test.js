import assert from "node:assert/strict";
import test from "node:test";

import { Position } from "../src/core/position.js";
import { explainIllegalMove, illegalReasonSentence } from "../src/core/illegal-move.js";
import { GameSession, MoveError } from "../src/ui/game.js";

const reason = (fen, uci) => explainIllegalMove(Position.fromFen(fen), uci).code;

test("an empty origin and an opponent's piece are distinguished", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(reason(fen, "e3e4"), "empty-square");
  assert.equal(reason(fen, "e7e5"), "opponent-piece");
  assert.equal(Position.fromFen(fen).moveFromUci("e7e5"), null, "out-of-turn move is never legal");
  assert.equal(reason(fen, "a1a1"), "malformed");
});

test("pinned piece cannot move away from its king", () => {
  const result = explainIllegalMove(Position.fromFen("4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1"), "e2d2");
  assert.equal(result.code, "leaves-king-in-check");
  assert.match(illegalReasonSentence(result), /king in check/i);
});

test("castling distinguishes missing rights, blocked path and attacked transit", () => {
  assert.equal(reason("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1", "e1g1"), "castle-rights");
  assert.equal(reason("r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1", "e1g1"), "castle-blocked");
  assert.equal(reason("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1", "e1g1"), "castle-through-check");
});

test("promotion is required in the chat protocol; illegal suffix is explained", () => {
  const fen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
  assert.equal(reason(fen, "a7a8"), "promotion-required");
  assert.equal(reason(fen, "a7a6q"), "promotion-illegal");
  const session = new GameSession({ playerColor: "b", initialFen: fen });
  const result = session.playAiMove("a7a8");
  assert.equal(result.code, MoveError.ILLEGAL);
  assert.equal(result.reason.code, "promotion-required");
  assert.equal(session.plyCount, 0);
});

test("en passant without an immediate capture right is not a pawn capture", () => {
  assert.equal(reason("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1", "e5d6"), "en-passant-illegal");
  // Capturing en passant may also be forbidden by a discovered check.
  assert.equal(reason("4r2k/8/8/3pP3/8/8/8/4K3 w - d6 0 2", "e5d6"), "leaves-king-in-check");
});

test("geometry and blockers are not confused with missing legal-set entries", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(reason(fen, "c1c4"), "does-not-move-that-way");
  assert.equal(reason(fen, "a1a4"), "blocked");
});
