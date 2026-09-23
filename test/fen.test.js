import assert from "node:assert/strict";
import test from "node:test";

import { parseSquare } from "../src/core/squares.js";
import {
  CastlingRight,
  FenError,
  START_FEN,
  formatCastling,
  isValidFen,
  parseCastling,
  parseFen,
  toFen,
} from "../src/core/fen.js";

test("the start position round-trips through FEN", () => {
  const state = parseFen(START_FEN);
  assert.equal(toFen(state), START_FEN);
  assert.equal(state.turn, "w");
  assert.equal(state.castling, CastlingRight.ALL);
  assert.equal(state.enPassant, -1);
  assert.equal(state.halfmove, 0);
  assert.equal(state.fullmove, 1);
});

test("FEN fields are parsed into board and metadata", () => {
  const state = parseFen("r3k2r/8/8/4Pp2/8/8/8/4K3 w kq f6 12 34", { strict: false });
  assert.equal(state.board[parseSquare("e1")], "K", "e1 holds the white king");
  assert.equal(state.board[parseSquare("e8")], "k", "e8 holds the black king");
  assert.equal(state.board[parseSquare("a8")], "r", "a8 holds a black rook");
  assert.equal(state.board[parseSquare("f5")], "p", "f5 holds a black pawn");
  assert.equal(state.turn, "w");
  assert.equal(formatCastling(state.castling), "kq");
  assert.equal(state.halfmove, 12);
  assert.equal(state.fullmove, 34);
  assert.equal(toFen(state), "r3k2r/8/8/4Pp2/8/8/8/4K3 w kq f6 12 34");
});

test("FEN without counters defaults to 0 and 1", () => {
  const state = parseFen("4k3/8/8/8/8/8/8/4K3 w - -", { strict: false });
  assert.equal(state.halfmove, 0);
  assert.equal(state.fullmove, 1);
});

test("invalid FEN strings are rejected with a clear message", () => {
  const invalid = [
    ["", /four to six/],
    ["not a fen", /four to six/],
    ["8/8/8/8/8/8/8 w - - 0 1", /eight ranks/],
    ["4k3/8/8/8/8/8/8/4K3 x - - 0 1", /side to move/],
    ["4k3/8/8/8/8/8/8/4K3 w XYZ - 0 1", /castling/],
    ["4k3/8/8/8/8/8/8/4K3 w KK - 0 1", /Duplicate/],
    ["4k3/8/8/8/8/8/8/4K3 w - z9 0 1", /en-passant/],
    ["4k3/8/8/8/8/8/8/4K3 w - e3 0 1", /rank 6/],
    ["4k3/8/8/8/8/8/8/4K3 w - - x 1", /halfmove/],
    ["4k3/8/8/8/8/8/8/4K3 w - - 0 0", /fullmove/],
    ["8/8/8/8/8/8/8/8 w - - 0 1", /one king/],
    ["4k3/8/8/8/8/8/8/4KK2 w - - 0 1", /one king/],
    ["4k3/8/8/8/8/8/8/4K3 w - - 0 1 2", /four to six/],
    ["4k3/8/8/8/9/8/8/4K3 w - - 0 1", /more than eight squares|Unexpected/],
    ["4k3/8/8/8/8/8/7/4K3 w - - 0 1", /squares instead of eight/],
  ];

  for (const [fen, pattern] of invalid) {
    assert.throws(
      () => parseFen(fen),
      (error) => error instanceof FenError && pattern.test(error.message),
      fen,
    );
    assert.equal(isValidFen(fen), false, fen);
  }
});

test("strict parsing rejects a position where the waiting side is in check", () => {
  assert.throws(() => parseFen("4k3/8/8/8/8/8/8/4R1K1 w - - 0 1"), /not to move is in check/);
  assert.doesNotThrow(() => parseFen("4k3/8/8/8/8/8/8/4R1K1 w - - 0 1", { strict: false }));
  assert.doesNotThrow(() => parseFen("4k3/8/8/8/8/8/8/4Q1K1 b - - 0 1"), "the side to move may be in check");
});

test("isValidFen accepts real positions and rejects nonsense", () => {
  assert.ok(isValidFen(START_FEN));
  assert.ok(isValidFen("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"));
  assert.ok(!isValidFen("hello"));
  assert.ok(!isValidFen(null));
  assert.ok(!isValidFen(undefined));
});

test("castling rights round-trip through every combination", () => {
  for (let mask = 0; mask < 16; mask += 1) {
    const text = formatCastling(mask);
    assert.equal(parseCastling(text), mask, `mask ${mask} (${text})`);
  }
});
