/**
 * Static evaluation for chess positions — material + piece-square tables.
 *
 * Heuristic only, labelled as such in UI. No false precision.
 * Pure, DOM-free.
 *
 * @module core/eval
 */

import { fileOf, rankOf } from "./squares.js";

// Material values in centipawns
export const MATERIAL = Object.freeze({
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
});

// Piece-square tables (from white perspective, a1=0). Simplified, oriented for white.
// Values are small adjustments to encourage centralization, development, etc.

const PAWN_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0,
  0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_TABLE = [
  -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15,
  20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_TABLE = [
  -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10,
  5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 5, 5, 5, 5, -10, -10, 0, 5, 0, 0, 5, 0, -10, -20, -10, -10, -10,
  -10, -10, -10, -20,
];

const ROOK_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0,
  0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
];

const QUEEN_TABLE = [
  -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0,
  -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10,
  -20,
];

const KING_TABLE_MIDDLE = [
  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40,
  -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20,
  -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
];

const KING_TABLE_END = [
  -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30,
  -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0,
  0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
];

const TABLES = {
  p: PAWN_TABLE,
  n: KNIGHT_TABLE,
  b: BISHOP_TABLE,
  r: ROOK_TABLE,
  q: QUEEN_TABLE,
  k: KING_TABLE_MIDDLE,
};

function mirrorForBlack(square) {
  // Flip rank for black perspective
  const file = fileOf(square);
  const rank = rankOf(square);
  const mirroredRank = 7 - rank;
  return mirroredRank * 8 + file;
}

/**
 * Evaluates position from white's perspective.
 * Positive = white better, negative = black better.
 *
 * @param {import('./position.js').Position} position
 * @returns {number} centipawn evaluation
 */
export function evaluate(position) {
  let score = 0;
  const board = position.boardSnapshot();

  // Material + PST
  for (let sq = 0; sq < 64; sq += 1) {
    const piece = board[sq];
    if (!piece) continue;
    const type = piece.toLowerCase();
    const isWhite = piece === piece.toUpperCase();
    const material = MATERIAL[type] || 0;

    let pst = 0;
    if (type === "k") {
      // Use middle game table for now; could switch based on material
      const table = isEndgame(board) ? KING_TABLE_END : KING_TABLE_MIDDLE;
      pst = isWhite ? table[sq] : table[mirrorForBlack(sq)];
    } else {
      const table = TABLES[type];
      if (table) {
        pst = isWhite ? table[sq] : table[mirrorForBlack(sq)];
      }
    }

    if (isWhite) {
      score += material + pst;
    } else {
      score -= material + pst;
    }
  }

  // Turn bonus: small tempo
  if (position.turn === "w") {
    score += 10;
  } else {
    score -= 10;
  }

  return score;
}

/**
 * @param {string[]} board
 * @returns {boolean} true when endgame (queens off or low material)
 */
function isEndgame(board) {
  let queens = 0;
  let minors = 0;
  for (const piece of board) {
    if (!piece) continue;
    const type = piece.toLowerCase();
    if (type === "q") queens += 1;
    if (type === "n" || type === "b" || type === "r") minors += 1;
  }
  return queens === 0 || (queens === 2 && minors <= 4);
}

/**
 * Converts centipawn score to a human-friendly description.
 *
 * @param {number} cp centipawns from white perspective
 * @returns {{text:string, kind:string}} e.g. "+0.3" or "#M1"
 */
export function formatEval(cp) {
  if (Math.abs(cp) >= 19000) {
    const mateIn = cp > 0 ? Math.ceil((20000 - cp) / 100) : Math.ceil((20000 + cp) / 100);
    return { text: cp > 0 ? `#${mateIn}` : `-#${mateIn}`, kind: cp > 0 ? "white" : "black" };
  }
  const pawns = (cp / 100).toFixed(1);
  const sign = cp > 0 ? "+" : "";
  return { text: `${sign}${pawns}`, kind: cp > 0 ? "white" : cp < 0 ? "black" : "equal" };
}

/**
 * Classifies a move based on eval swing (heuristic).
 *
 * @param {number} beforeEval eval before move (from mover perspective)
 * @param {number} afterEval eval after move (from mover perspective)
 * @returns {'brilliant'|'good'|'inaccuracy'|'mistake'|'blunder'}
 */
export function classifyMove(beforeEval, afterEval) {
  const swing = afterEval - beforeEval; // negative means worse
  if (swing >= 0) {
    return swing > 100 ? "brilliant" : "good";
  }
  const loss = -swing;
  if (loss < 50) return "good";
  if (loss < 150) return "inaccuracy";
  if (loss < 300) return "mistake";
  return "blunder";
}

export { PAWN_TABLE, KNIGHT_TABLE, BISHOP_TABLE, ROOK_TABLE, QUEEN_TABLE, KING_TABLE_MIDDLE, KING_TABLE_END };
