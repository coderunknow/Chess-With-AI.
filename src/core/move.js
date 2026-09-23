/**
 * Move model and UCI codec.
 *
 * A move is a small immutable record: `{ from, to, promotion, flags }` with
 * square indices plus a bitmask of {@link MoveFlag} values. Keeping moves as
 * plain data (instead of a packed integer) keeps the engine readable and easy
 * to extend, at a cost that is irrelevant for a move-legality engine.
 *
 * @module core/move
 */

import { PROMOTION_PIECES } from "./pieces.js";
import { toName, parseSquare } from "./squares.js";

/** Bit flags describing how a move is executed. */
export const MoveFlag = Object.freeze({
  NORMAL: 0,
  CAPTURE: 1 << 0,
  BIG_PAWN: 1 << 1,
  EN_PASSANT: 1 << 2,
  PROMOTION: 1 << 3,
  KING_CASTLE: 1 << 4,
  QUEEN_CASTLE: 1 << 5,
});

const UCI_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

/**
 * @typedef {object} Move
 * @property {number} from source square index.
 * @property {number} to target square index.
 * @property {string} promotion promotion piece type (`''` when not promoting).
 * @property {number} flags bitmask of {@link MoveFlag}.
 */

/**
 * @param {object} input
 * @param {number} input.from
 * @param {number} input.to
 * @param {string} [input.promotion]
 * @param {number} [input.flags]
 * @returns {Move} a new move record.
 */
export function createMove({ from, to, promotion = "", flags = MoveFlag.NORMAL }) {
  return Object.freeze({ from, to, promotion, flags });
}

/**
 * @param {Move} move
 * @returns {boolean} true when the move captures a piece.
 */
export function isCapture(move) {
  return (move.flags & (MoveFlag.CAPTURE | MoveFlag.EN_PASSANT)) !== 0;
}

/**
 * @param {Move} move
 * @returns {boolean} true when the move promotes a pawn.
 */
export function isPromotion(move) {
  return (move.flags & MoveFlag.PROMOTION) !== 0;
}

/**
 * @param {Move} move
 * @returns {boolean} true for either castling move.
 */
export function isCastle(move) {
  return (move.flags & (MoveFlag.KING_CASTLE | MoveFlag.QUEEN_CASTLE)) !== 0;
}

/**
 * @param {Move} move
 * @returns {string} UCI representation, e.g. `e7e8q`.
 */
export function toUci(move) {
  return `${toName(move.from)}${toName(move.to)}${move.promotion}`;
}

/**
 * @param {Move} a
 * @param {Move} b
 * @returns {boolean} true when both moves describe the same action.
 */
export function equals(a, b) {
  return a.from === b.from && a.to === b.to && a.promotion === b.promotion;
}

/**
 * Parses UCI text without consulting a position. Use
 * {@link module:core/position.Position#moveFromUci} to resolve a legal move.
 *
 * @param {unknown} text
 * @returns {{from: number, to: number, promotion: string}|null}
 */
export function parseUci(text) {
  if (typeof text !== "string") {
    return null;
  }

  const match = UCI_PATTERN.exec(text.trim().toLowerCase());
  if (!match) {
    return null;
  }

  const from = parseSquare(match[1]);
  const to = parseSquare(match[2]);
  const promotion = match[3] || "";
  if (from === -1 || to === -1 || from === to) {
    return null;
  }
  if (promotion && !PROMOTION_PIECES.includes(promotion)) {
    return null;
  }

  return { from, to, promotion };
}

/**
 * @param {unknown} text
 * @returns {boolean} true when `text` is syntactically valid UCI.
 */
export function isValidUci(text) {
  return parseUci(text) !== null;
}
