/**
 * Attack tables and attacked-square detection.
 *
 * All tables are precomputed once at module load. `isSquareAttacked` walks
 * *from* the target square outwards, which is the cheapest way to answer
 * "is this square attacked by color X" without generating moves.
 *
 * @module core/attacks
 */

import { PieceType } from "./pieces.js";
import { fileOf, rankOf, toIndex } from "./squares.js";

// Deltas are [fileDelta, rankDelta] in board orientation (a1 at the origin).
const KNIGHT_DELTAS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const KING_DELTAS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Orthogonal then diagonal ray directions, used by sliders and threat scans. */
export const RAY_DIRECTIONS = Object.freeze([...KING_DELTAS.slice(0, 4), ...KING_DELTAS.slice(4)]);

const ORTHOGONAL_DIRECTIONS = Object.freeze([
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]);

const DIAGONAL_DIRECTIONS = Object.freeze([
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
]);

/**
 * @param {ReadonlyArray<ReadonlyArray<number>>} deltas
 * @returns {number[][]} index -> reachable square indices.
 */
function buildAttackTable(deltas) {
  const table = [];
  for (let square = 0; square < 64; square += 1) {
    const targets = [];
    for (const [fileDelta, rankDelta] of deltas) {
      const target = toIndex(fileOf(square) + fileDelta, rankOf(square) + rankDelta);
      if (target !== -1) {
        targets.push(target);
      }
    }
    table.push(targets);
  }
  return table;
}

/**
 * @param {ReadonlyArray<ReadonlyArray<number>>} directions
 * @returns {number[][][]} `[direction][square] -> squares along that ray`.
 */
function buildRayTable(directions) {
  return directions.map(([fileDelta, rankDelta]) => {
    const table = [];
    for (let square = 0; square < 64; square += 1) {
      const ray = [];
      let file = fileOf(square) + fileDelta;
      let rank = rankOf(square) + rankDelta;
      while (file >= 0 && file <= 7 && rank >= 0 && rank <= 7) {
        ray.push(toIndex(file, rank));
        file += fileDelta;
        rank += rankDelta;
      }
      table.push(ray);
    }
    return table;
  });
}

/** `KNIGHT_MOVES[square]` -> squares a knight can jump to. */
export const KNIGHT_MOVES = Object.freeze(buildAttackTable(KNIGHT_DELTAS));

/** `KING_MOVES[square]` -> squares a king can step to. */
export const KING_MOVES = Object.freeze(buildAttackTable(KING_DELTAS));

/** `ORTHOGONAL_RAYS[direction][square]` -> squares towards that edge. */
export const ORTHOGONAL_RAYS = Object.freeze(buildRayTable(ORTHOGONAL_DIRECTIONS));

/** `DIAGONAL_RAYS[direction][square]` -> squares towards that corner. */
export const DIAGONAL_RAYS = Object.freeze(buildRayTable(DIAGONAL_DIRECTIONS));

/**
 * Squares a pawn of `color` on `square` attacks.
 *
 * @param {number} square
 * @param {'w'|'b'} color
 * @returns {number[]} attacked square indices.
 */
export function pawnAttacks(square, color) {
  const rankDelta = color === "w" ? 1 : -1;
  const attacks = [];
  for (const fileDelta of [-1, 1]) {
    const target = toIndex(fileOf(square) + fileDelta, rankOf(square) + rankDelta);
    if (target !== -1) {
      attacks.push(target);
    }
  }
  return attacks;
}

/**
 * @param {ReadonlyArray<string>} board 64 entries, `''` for empty squares.
 * @param {number} square
 * @param {'w'|'b'} byColor attacking color.
 * @returns {boolean} true when `byColor` attacks `square`.
 */
export function isSquareAttacked(board, square, byColor) {
  const pawn = byColor === "w" ? "P" : "p";
  const pawnRankDelta = byColor === "w" ? -1 : 1;
  for (const fileDelta of [-1, 1]) {
    const source = toIndex(fileOf(square) + fileDelta, rankOf(square) + pawnRankDelta);
    if (source !== -1 && board[source] === pawn) {
      return true;
    }
  }

  const knight = byColor === "w" ? "N" : "n";
  for (const source of KNIGHT_MOVES[square]) {
    if (board[source] === knight) {
      return true;
    }
  }

  const king = byColor === "w" ? "K" : "k";
  for (const source of KING_MOVES[square]) {
    if (board[source] === king) {
      return true;
    }
  }

  const bishop = byColor === "w" ? "B" : "b";
  const rook = byColor === "w" ? "R" : "r";
  const queen = byColor === "w" ? "Q" : "q";

  for (const rays of [ORTHOGONAL_RAYS, DIAGONAL_RAYS]) {
    const slider = rays === ORTHOGONAL_RAYS ? rook : bishop;
    for (const ray of rays) {
      for (const candidate of ray[square]) {
        const piece = board[candidate];
        if (!piece) {
          continue;
        }
        if (piece === slider || piece === queen) {
          return true;
        }
        break;
      }
    }
  }

  return false;
}

/**
 * @param {string} piece
 * @returns {boolean} true when the piece type moves along rays.
 */
export function isSlidingPiece(piece) {
  const type = piece.toLowerCase();
  return type === PieceType.BISHOP || type === PieceType.ROOK || type === PieceType.QUEEN;
}
