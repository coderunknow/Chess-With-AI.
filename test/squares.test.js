import assert from "node:assert/strict";
import test from "node:test";

import {
  fileOf,
  isLightSquare,
  isValidName,
  offset,
  parseSquare,
  rankOf,
  toIndex,
  toName,
} from "../src/core/squares.js";
import { KING_MOVES, KNIGHT_MOVES, isSquareAttacked, pawnAttacks } from "../src/core/attacks.js";

test("square indices and names convert both ways", () => {
  assert.equal(toName(0), "a1");
  assert.equal(toName(63), "h8");
  assert.equal(parseSquare("a1"), 0);
  assert.equal(parseSquare("h8"), 63);
  assert.equal(parseSquare("e4"), 28);
  assert.equal(fileOf(parseSquare("e4")), 4);
  assert.equal(rankOf(parseSquare("e4")), 3);

  for (let square = 0; square < 64; square += 1) {
    assert.equal(parseSquare(toName(square)), square);
  }
});

test("invalid square names are refused", () => {
  assert.equal(parseSquare("i9"), -1);
  assert.equal(parseSquare("e"), -1);
  assert.equal(parseSquare("e4x"), -1);
  assert.equal(parseSquare(42), -1);
  assert.equal(isValidName("z1"), false);
  assert.equal(isValidName("e4"), true);
  assert.equal(isValidName(""), false);
});

test("a1 is a dark square and h1 is light", () => {
  assert.equal(isLightSquare(parseSquare("a1")), false);
  assert.equal(isLightSquare(parseSquare("h1")), true);
  assert.equal(isLightSquare(parseSquare("a8")), true);
  assert.equal(isLightSquare(parseSquare("h8")), false);
});

test("offsets clamp at the board edge", () => {
  assert.equal(toName(offset(parseSquare("e4"), 0, 1)), "e5");
  assert.equal(offset(parseSquare("h8"), 1, 0), -1);
  assert.equal(offset(parseSquare("a1"), -1, 0), -1);
  assert.equal(toIndex(8, 0), -1);
  assert.equal(toIndex(0, -1), -1);
});

test("attack tables are precomputed and correct", () => {
  assert.equal(KNIGHT_MOVES[parseSquare("a1")].length, 2);
  assert.deepEqual(KNIGHT_MOVES[parseSquare("a1")].map(toName).sort(), ["b3", "c2"]);
  assert.equal(KNIGHT_MOVES[parseSquare("e4")].length, 8);
  assert.equal(KING_MOVES[parseSquare("e4")].length, 8);
  assert.equal(KING_MOVES[parseSquare("a1")].length, 3);
  assert.deepEqual(pawnAttacks(parseSquare("e4"), "w").map(toName).sort(), ["d5", "f5"]);
  assert.deepEqual(pawnAttacks(parseSquare("e4"), "b").map(toName).sort(), ["d3", "f3"]);
  assert.deepEqual(pawnAttacks(parseSquare("a2"), "w").map(toName), ["b3"]);
});

test("attacked squares are detected for every piece type", () => {
  const board = new Array(64).fill("");
  const set = (name, piece) => {
    board[parseSquare(name)] = piece;
  };

  set("e1", "K");
  set("h8", "k");
  set("d4", "Q");
  set("a3", "R");
  set("b7", "B");
  set("f5", "N");
  set("g2", "P");
  set("h7", "p");

  assert.ok(isSquareAttacked(board, parseSquare("d8"), "w"), "queen on d4 attacks d8");
  assert.ok(isSquareAttacked(board, parseSquare("a8"), "w"), "rook on a3 attacks a8");
  assert.ok(isSquareAttacked(board, parseSquare("e4"), "w"), "bishop on b7 attacks e4");
  assert.ok(isSquareAttacked(board, parseSquare("g7"), "w"), "knight on f5 attacks g7");
  assert.ok(isSquareAttacked(board, parseSquare("f3"), "w"), "pawn on g2 attacks f3");
  assert.ok(isSquareAttacked(board, parseSquare("g6"), "b"), "black pawn on h7 attacks g6");
  assert.ok(!isSquareAttacked(board, parseSquare("c1"), "w"), "nothing attacks c1");
});
