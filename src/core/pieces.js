/**
 * Piece model.
 *
 * Pieces are represented by their FEN character. Using the FEN alphabet as the
 * canonical in-memory representation keeps the engine directly interoperable
 * with FEN, SAN, PGN and UCI text, so no conversion layer is ever required.
 *
 *   'P','N','B','R','Q','K' -> white
 *   'p','n','b','r','q','k' -> black
 *
 * @module core/pieces
 */

/** Side to move / piece owner. */
export const Color = Object.freeze({
  WHITE: "w",
  BLACK: "b",
});

/** Lower-case piece types, mirroring FEN/SAN letters. */
export const PieceType = Object.freeze({
  PAWN: "p",
  KNIGHT: "n",
  BISHOP: "b",
  ROOK: "r",
  QUEEN: "q",
  KING: "k",
});

/** Promotion choices, strongest first (used by the promotion dialog too). */
export const PROMOTION_PIECES = Object.freeze(["q", "r", "b", "n"]);

/** Unicode chess glyphs, indexed by FEN character. */
export const PIECE_GLYPHS = Object.freeze({
  K: "\u2654",
  Q: "\u2655",
  R: "\u2656",
  B: "\u2657",
  N: "\u2658",
  P: "\u2659",
  k: "\u265A",
  q: "\u265B",
  r: "\u265C",
  b: "\u265D",
  n: "\u265E",
  p: "\u265F",
});

/** Human readable piece names, indexed by piece type. */
export const PIECE_NAMES = Object.freeze({
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
});

const PIECE_PATTERN = /^[pnbrqk]$/i;

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is a single piece character.
 */
export function isPiece(value) {
  return typeof value === "string" && PIECE_PATTERN.test(value);
}

/**
 * @param {string} piece
 * @returns {boolean} true for white pieces.
 */
export function isWhitePiece(piece) {
  return piece === piece.toUpperCase();
}

/**
 * @param {string} piece
 * @returns {'w'|'b'} owner of `piece`.
 */
export function colorOf(piece) {
  return isWhitePiece(piece) ? Color.WHITE : Color.BLACK;
}

/**
 * @param {string} piece
 * @returns {string} lower-case piece type, e.g. 'q'.
 */
export function typeOf(piece) {
  return piece.toLowerCase();
}

/**
 * @param {'w'|'b'} color
 * @param {string} type lower-case piece type.
 * @returns {string} FEN character for `color`/`type`.
 */
export function pieceOf(color, type) {
  const lower = type.toLowerCase();
  return color === Color.WHITE ? lower.toUpperCase() : lower;
}

/**
 * @param {'w'|'b'} color
 * @returns {'w'|'b'} the opposing color.
 */
export function opposite(color) {
  return color === Color.WHITE ? Color.BLACK : Color.WHITE;
}
