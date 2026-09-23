/**
 * Square geometry.
 *
 * Squares are addressed by an index in `[0, 63]` where `0` is `a1` and `63` is
 * `h1`. This keeps file/rank arithmetic branch-free:
 *
 *   file = index & 7
 *   rank = index >> 3
 *
 * @module core/squares
 */

export const FILES = "abcdefgh";
export const RANKS = "12345678";
export const BOARD_SIZE = 8;
export const SQUARE_COUNT = 64;

const SQUARE_PATTERN = /^[a-h][1-8]$/;

/**
 * @param {number} file 0-7, `a` is 0.
 * @param {number} rank 0-7, rank `1` is 0.
 * @returns {number} square index, or -1 when out of bounds.
 */
export function toIndex(file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) {
    return -1;
  }
  return rank * BOARD_SIZE + file;
}

/**
 * @param {number} square
 * @returns {number} file index 0-7.
 */
export function fileOf(square) {
  return square & 7;
}

/**
 * @param {number} square
 * @returns {number} rank index 0-7.
 */
export function rankOf(square) {
  return square >> 3;
}

/**
 * @param {number} square
 * @returns {string} algebraic name, e.g. `e4`.
 */
export function toName(square) {
  if (square < 0 || square > 63) {
    return "";
  }
  return `${FILES[fileOf(square)]}${RANKS[rankOf(square)]}`;
}

/**
 * @param {string} name algebraic square name.
 * @returns {number} square index, or -1 when invalid.
 */
export function parseSquare(name) {
  if (typeof name !== "string" || !SQUARE_PATTERN.test(name)) {
    return -1;
  }
  return toIndex(FILES.indexOf(name[0]), RANKS.indexOf(name[1]));
}

/**
 * @param {unknown} name
 * @returns {boolean} true when `name` is a valid algebraic square.
 */
export function isValidName(name) {
  return typeof name === "string" && SQUARE_PATTERN.test(name);
}

/**
 * @param {number} square
 * @returns {boolean} true for light squares (`a1` is dark).
 */
export function isLightSquare(square) {
  return (fileOf(square) + rankOf(square)) % 2 === 1;
}

/**
 * @param {number} square
 * @param {number} fileDelta
 * @param {number} rankDelta
 * @returns {number} neighbour index, or -1 when the offset leaves the board.
 */
export function offset(square, fileDelta, rankDelta) {
  return toIndex(fileOf(square) + fileDelta, rankOf(square) + rankDelta);
}
