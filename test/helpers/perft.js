/**
 * Perft (performance test) reference implementation.
 *
 * Perft walks the entire legal move tree to a given depth and counts the leaf
 * nodes. Comparing against the published node counts from
 * https://www.chessprogramming.org/Perft_Results is the strongest correctness
 * check available for a move generator.
 *
 * @module test/helpers/perft
 */

import { toUci } from "../../src/core/move.js";

/**
 * @param {import('../../src/core/position.js').Position} position
 * @param {number} depth
 * @returns {number} number of leaf nodes at `depth`.
 */
export function perft(position, depth) {
  if (depth === 0) {
    return 1;
  }

  const moves = position.legalMoves();
  if (depth === 1) {
    return moves.length;
  }

  let nodes = 0;
  for (const move of moves) {
    position.makeMove(move, { validate: false });
    nodes += perft(position, depth - 1);
    position.unmakeMove();
  }
  return nodes;
}

/**
 * Counts the nodes reached by each legal root move — the standard way to
 * localise a perft mismatch.
 *
 * @param {import('../../src/core/position.js').Position} position
 * @param {number} depth
 * @returns {Map<string, number>} node counts keyed by UCI move.
 */
export function divide(position, depth) {
  const result = new Map();
  for (const move of position.legalMoves()) {
    const uci = toUci(move);
    position.makeMove(move, { validate: false });
    result.set(uci, perft(position, depth - 1));
    position.unmakeMove();
  }
  return result;
}
