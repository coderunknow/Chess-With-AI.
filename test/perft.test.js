import assert from "node:assert/strict";
import test from "node:test";

import { Position } from "../src/core/position.js";
import { perft } from "./helpers/perft.js";

/**
 * Published perft results — https://www.chessprogramming.org/Perft_Results
 * Depths were chosen so the suite stays well under a few seconds.
 */
const SUITES = [
  {
    name: "start position",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    expected: [20, 400, 8902],
  },
  {
    name: "kiwipete (castling, pins, promotions)",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    expected: [48, 2039, 97862],
  },
  {
    name: "endgame (en passant, checks, rook shuffles)",
    fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    expected: [14, 191, 2812, 43238],
  },
  {
    name: "promotion heavy",
    fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    expected: [6, 264, 9467],
  },
  {
    name: "tricky promotions and castles",
    fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    expected: [44, 1486, 62379],
  },
  {
    name: "middlegame (pins, discovered checks)",
    fen: "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    expected: [46, 2079, 89890],
  },
];

for (const suite of SUITES) {
  test(`perft: ${suite.name}`, () => {
    const position = Position.fromFen(suite.fen, { strict: false });
    suite.expected.forEach((nodes, index) => {
      assert.equal(perft(position, index + 1), nodes, `depth ${index + 1}`);
      assert.equal(position.toFen(), suite.fen, "position restored after perft");
    });
  });
}
