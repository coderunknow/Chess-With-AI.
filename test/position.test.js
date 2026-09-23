import assert from "node:assert/strict";
import test from "node:test";

import { Position } from "../src/core/position.js";
import { toUci } from "../src/core/move.js";
import { toName, parseSquare } from "../src/core/squares.js";

/**
 * @param {string} fen
 * @returns {string[]} sorted UCI move list.
 */
function movesFrom(fen) {
  return Position.fromFen(fen, { strict: false }).legalMoves().map(toUci).sort();
}

test("start position has the twenty standard moves", () => {
  const moves = movesFrom("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(moves.length, 20);
  assert.ok(moves.includes("e2e4"));
  assert.ok(moves.includes("g1f3"));
  assert.ok(!moves.includes("e2e5"));
});

test("a piece pinned to its king may only move along the pin", () => {
  const position = Position.fromFen("4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1", { strict: false });
  assert.deepEqual(position.legalMovesFrom(parseSquare("e2")).map(toUci).sort(), [
    "e2e3",
    "e2e4",
    "e2e5",
    "e2e6",
    "e2e7",
    "e2e8",
  ]);
  assert.ok(!position.legalMoves().map(toUci).includes("e2a2"), "leaving the e-file is illegal");
});

test("the king may not step onto an attacked square", () => {
  const moves = movesFrom("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1");
  assert.deepEqual(moves, ["e1d1", "e1e2", "e1f1"], "d2 and f2 are attacked by the rook");
});

test("castling requires rights, empty squares and a safe path", () => {
  const legal = movesFrom("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  assert.ok(legal.includes("e1g1"));
  assert.ok(legal.includes("e1c1"));

  const blocked = movesFrom("r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1");
  assert.ok(!blocked.includes("e1g1"), "f1 occupied");
  assert.ok(blocked.includes("e1c1"));

  const throughCheck = movesFrom("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1");
  assert.ok(!throughCheck.includes("e1g1"), "f1 attacked");

  const inCheck = movesFrom("r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1");
  assert.ok(!inCheck.includes("e1g1") && !inCheck.includes("e1c1"));

  const noRights = movesFrom("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1");
  assert.ok(!noRights.includes("e1g1") && !noRights.includes("e1c1"));
});

test("castling moves the rook and updates the FEN", () => {
  const position = Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const move = position.moveFromUci("e1g1");
  assert.ok(move);
  position.makeMove(move);
  assert.equal(position.pieceAt(parseSquare("g1")), "K");
  assert.equal(position.pieceAt(parseSquare("f1")), "R");
  assert.equal(position.pieceAt(parseSquare("h1")), "");
  assert.equal(position.toFen(), "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1");
});

test("castling rights are lost when the rook moves or is captured", () => {
  const moved = Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  moved.makeMove(moved.moveFromUci("a1a2"));
  assert.equal(moved.castlingRights & 0b0010, 0, "white queen-side right removed");
  assert.equal(moved.castlingRights & 0b0001, 0b0001, "white king-side right kept");

  const captured = Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1");
  captured.makeMove(captured.moveFromUci("a8a1"));
  assert.equal(captured.castlingRights & 0b1000, 0, "black king-side right removed");
  assert.equal(captured.castlingRights & 0b0010, 0, "white queen-side right removed");
});

test("en passant is only available on the immediate reply", () => {
  const position = Position.start();
  position.makeMove(position.moveFromUci("e2e4"));
  assert.equal(toName(position.enPassantSquare), "e3", "double push always sets the target square");
  position.makeMove(position.moveFromUci("a7a6"));
  position.makeMove(position.moveFromUci("e4e5"));
  assert.equal(position.enPassantSquare, -1, "a normal move clears the target square");

  position.makeMove(position.moveFromUci("d7d5"));
  assert.equal(toName(position.enPassantSquare), "d6");
  assert.ok(position.legalMoves().map(toUci).includes("e5d6"), "white may capture en passant");

  position.makeMove(position.moveFromUci("g1f3"));
  position.makeMove(position.moveFromUci("a6a5"));
  assert.equal(position.enPassantSquare, -1);
  assert.ok(!position.legalMoves().map(toUci).includes("e5d6"), "the right expires after one ply");
});

test("en passant capture removes the captured pawn", () => {
  const position = Position.fromFen("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3");
  const move = position.moveFromUci("e5d6");
  assert.ok(move);
  position.makeMove(move);
  assert.equal(position.pieceAt(parseSquare("d5")), "", "captured pawn removed");
  assert.equal(position.pieceAt(parseSquare("d6")), "P");
});

test("a pawn may not be captured en passant when the capture exposes the king", () => {
  // White king on e5, black pawn double-pushes to d5; capturing would expose the
  // king to the rook on e8.
  const moves = movesFrom("4r2k/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
  assert.ok(!moves.includes("e5d6"));
});

test("promotion produces four moves and can be selected", () => {
  const position = Position.fromFen("8/4P3/8/8/8/8/8/4K2k w - - 0 1", { strict: false });
  const promotions = position.legalMovesFrom(parseSquare("e7")).map(toUci).sort();
  assert.deepEqual(promotions, ["e7e8b", "e7e8n", "e7e8q", "e7e8r"]);

  position.makeMove(position.moveFromUci("e7e8n"));
  assert.equal(position.pieceAt(parseSquare("e8")), "N");
  assert.equal(position.turn, "b");
});

test("promotion may deliver checkmate", () => {
  const position = Position.fromFen("7k/5P2/6K1/8/8/8/8/8 w - - 0 1", { strict: false });
  position.makeMove(position.moveFromUci("f7f8q"));
  assert.ok(position.isCheckmate(), "Qf8#");
  assert.equal(position.outcome().result, "1-0");
});

test("promotion defaults to a queen when the notation omits the piece", () => {
  const position = Position.fromFen("8/4P3/8/8/8/8/8/4K2k w - - 0 1", { strict: false });
  const move = position.moveFromUci("e7e8");
  assert.ok(move);
  assert.equal(move.promotion, "q");
});

test("checkmate, stalemate and check are reported correctly", () => {
  const mate = Position.fromFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
  assert.ok(mate.isCheck());
  assert.ok(mate.isCheckmate());
  assert.equal(mate.outcome().result, "0-1");
  assert.equal(mate.outcome().reason, "checkmate");

  const stalemate = Position.fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", { strict: false });
  assert.ok(stalemate.isStalemate());
  assert.equal(stalemate.outcome().result, "1/2-1/2");
});

test("insufficient material draws are detected", () => {
  assert.ok(Position.fromFen("8/8/4k3/8/8/3K4/8/8 w - - 0 1", { strict: false }).isInsufficientMaterial());
  assert.ok(Position.fromFen("8/8/4k3/8/8/3K1N2/8/8 w - - 0 1", { strict: false }).isInsufficientMaterial());
  assert.ok(Position.fromFen("8/8/4k3/8/8/3K1B2/8/8 w - - 0 1", { strict: false }).isInsufficientMaterial());
  assert.ok(!Position.fromFen("8/8/4k3/8/8/3K1N2/8/6n1 w - - 0 1", { strict: false }).isInsufficientMaterial());
  assert.ok(!Position.fromFen("8/8/4k3/8/8/3K4/8/3R4 w - - 0 1", { strict: false }).isInsufficientMaterial());
});

test("the fifty-move rule triggers on the hundredth halfmove", () => {
  const position = Position.fromFen("4k3/8/8/8/8/8/8/R3K2R w KQ - 99 60");
  assert.ok(!position.isFiftyMoveDraw());
  position.makeMove(position.moveFromUci("a1a2"));
  assert.ok(position.isFiftyMoveDraw());

  const pawnMove = Position.fromFen("4k3/8/8/8/8/4P3/8/4K3 w - - 99 60");
  pawnMove.makeMove(pawnMove.moveFromUci("e3e4"));
  assert.equal(pawnMove.halfmoveClock, 0, "pawn moves reset the clock");
});

test("threefold repetition is detected through the history", () => {
  const position = Position.start();
  const cycle = ["g1f3", "g8f6", "f3g1", "f6g8"];
  assert.equal(position.repetitionCount(), 1);

  for (let round = 0; round < 2; round += 1) {
    for (const uci of cycle) {
      position.makeMove(position.moveFromUci(uci));
    }
  }

  assert.equal(position.repetitionCount(), 3);
  assert.ok(position.isThreefoldRepetition());
  assert.equal(position.outcome().reason, "threefold-repetition");
});

test("unmakeMove restores the position exactly", () => {
  const position = Position.start();
  const before = position.toFen();
  const move = position.moveFromUci("e2e4");
  position.makeMove(move);
  assert.notEqual(position.toFen(), before);
  position.unmakeMove();
  assert.equal(position.toFen(), before);
  assert.equal(position.plyCount, 0);
});

test("illegal moves are rejected by makeMove", () => {
  const position = Position.start();
  assert.equal(position.makeMove({ from: parseSquare("e2"), to: parseSquare("e5"), promotion: "", flags: 0 }), null);
  assert.equal(position.toFen(), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(position.moveFromUci("e2e5"), null);
  assert.equal(position.moveFromUci("not-a-move"), null);
});

test("a position key ignores an en-passant square that cannot be captured", () => {
  const capturable = Position.fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2", { strict: false });
  assert.equal(capturable.enPassantSquare, parseSquare("d6"));
  assert.ok(capturable.key().endsWith(`|${capturable.enPassantSquare}`), "capturable en-passant square is in the key");

  const unreachable = Position.fromFen("4k3/8/8/3p4/8/8/8/4K3 w - d6 0 2", { strict: false });
  assert.ok(unreachable.key().endsWith("|-"), "no pawn can capture, so the square is ignored");

  const quiet = Position.fromFen("4k3/8/8/3p4/8/8/8/4K3 w - - 0 2", { strict: false });
  assert.equal(unreachable.key(), quiet.key(), "both positions are the same for repetition purposes");
});
