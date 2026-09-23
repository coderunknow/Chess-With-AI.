/**
 * Forsyth-Edwards Notation parsing and serialisation.
 *
 * @module core/fen
 */

import { Color } from "./pieces.js";
import { parseSquare, rankOf, toIndex, toName } from "./squares.js";
import { isSquareAttacked } from "./attacks.js";

/** Standard starting position. */
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Castling rights as a bitmask. */
export const CastlingRight = Object.freeze({
  WHITE_KING: 1 << 0,
  WHITE_QUEEN: 1 << 1,
  BLACK_KING: 1 << 2,
  BLACK_QUEEN: 1 << 3,
  ALL: 0b1111,
  NONE: 0,
});

const CASTLING_CHARS = Object.freeze([
  [CastlingRight.WHITE_KING, "K"],
  [CastlingRight.WHITE_QUEEN, "Q"],
  [CastlingRight.BLACK_KING, "k"],
  [CastlingRight.BLACK_QUEEN, "q"],
]);

/** Thrown when a FEN string is malformed or describes an impossible position. */
export class FenError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "FenError";
  }
}

/**
 * @typedef {object} PositionState
 * @property {string[]} board 64 entries, `''` for empty squares.
 * @property {'w'|'b'} turn side to move.
 * @property {number} castling castling-rights bitmask.
 * @property {number} enPassant en-passant target index, `-1` when unavailable.
 * @property {number} halfmove halfmove clock (for the fifty-move rule).
 * @property {number} fullmove fullmove counter, starting at 1.
 */

/**
 * @param {string} text castling field, e.g. `KQkq` or `-`.
 * @returns {number} castling bitmask.
 * @throws {FenError} when the field contains unknown characters or duplicates.
 */
export function parseCastling(text) {
  if (text === "-") {
    return CastlingRight.NONE;
  }

  let mask = CastlingRight.NONE;
  for (const character of text) {
    const entry = CASTLING_CHARS.find(([, symbol]) => symbol === character);
    if (!entry) {
      throw new FenError(`Invalid castling field "${text}".`);
    }
    if (mask & entry[0]) {
      throw new FenError(`Duplicate castling right "${character}".`);
    }
    mask |= entry[0];
  }
  return mask;
}

/**
 * @param {number} mask castling bitmask.
 * @returns {string} FEN castling field.
 */
export function formatCastling(mask) {
  const text = CASTLING_CHARS.filter(([right]) => (mask & right) !== 0)
    .map(([, symbol]) => symbol)
    .join("");
  return text || "-";
}

/**
 * @param {string} rankText one FEN rank, e.g. `rnbq1bnr`.
 * @param {number} rank 0-7.
 * @param {string[]} board target board to fill.
 * @throws {FenError} when the rank does not describe exactly eight squares.
 */
function parseRank(rankText, rank, board) {
  let file = 0;
  for (const symbol of rankText) {
    if (symbol >= "1" && symbol <= "8") {
      file += Number(symbol);
    } else if (/[pnbrqk]/i.test(symbol) && symbol.length === 1) {
      if (file > 7) {
        throw new FenError(`Rank ${8 - rank} describes more than eight squares.`);
      }
      board[toIndex(file, rank)] = symbol;
      file += 1;
    } else {
      throw new FenError(`Unexpected character "${symbol}" in rank ${8 - rank}.`);
    }
    if (file > 8) {
      throw new FenError(`Rank ${8 - rank} describes more than eight squares.`);
    }
  }
  if (file !== 8) {
    throw new FenError(`Rank ${8 - rank} describes ${file} squares instead of eight.`);
  }
}

/**
 * Parses a FEN string into a plain position state.
 *
 * @param {string} fen
 * @param {object} [options]
 * @param {boolean} [options.strict] when true (default) the position must be
 *   reachable in a real game: both kings present and the side *not* to move may
 *   not be in check.
 * @returns {PositionState}
 * @throws {FenError} when the input is invalid.
 */
export function parseFen(fen, { strict = true } = {}) {
  if (typeof fen !== "string") {
    throw new FenError("FEN must be a string.");
  }

  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4 || fields.length > 6) {
    throw new FenError("FEN must contain four to six space-separated fields.");
  }

  const [placementText, turnText, castlingText, enPassantText, halfmoveText, fullmoveText] = fields;
  const rankTexts = placementText.split("/");
  if (rankTexts.length !== 8) {
    throw new FenError("FEN placement must contain exactly eight ranks.");
  }

  const board = new Array(64).fill("");
  rankTexts.forEach((rankText, index) => parseRank(rankText, 7 - index, board));

  if (turnText !== "w" && turnText !== "b") {
    throw new FenError(`Invalid side to move "${turnText}".`);
  }

  const castling = parseCastling(castlingText);

  let enPassant = -1;
  if (enPassantText !== "-") {
    enPassant = parseSquare(enPassantText);
    if (enPassant === -1) {
      throw new FenError(`Invalid en-passant square "${enPassantText}".`);
    }
    const expectedRank = turnText === "w" ? 5 : 2;
    if (rankOf(enPassant) !== expectedRank) {
      throw new FenError(`En-passant square ${enPassantText} is not on rank ${expectedRank + 1}.`);
    }
  }

  const halfmove = halfmoveText === undefined ? 0 : Number(halfmoveText);
  if (!Number.isInteger(halfmove) || halfmove < 0) {
    throw new FenError(`Invalid halfmove clock "${halfmoveText}".`);
  }

  const fullmove = fullmoveText === undefined ? 1 : Number(fullmoveText);
  if (!Number.isInteger(fullmove) || fullmove < 1) {
    throw new FenError(`Invalid fullmove number "${fullmoveText}".`);
  }

  const whiteKings = board.filter((piece) => piece === "K").length;
  const blackKings = board.filter((piece) => piece === "k").length;
  if (whiteKings !== 1 || blackKings !== 1) {
    throw new FenError("A position must contain exactly one king per side.");
  }

  if (strict) {
    const waitingColor = turnText === Color.WHITE ? Color.BLACK : Color.WHITE;
    const waitingKing = board.indexOf(waitingColor === Color.WHITE ? "K" : "k");
    if (isSquareAttacked(board, waitingKing, turnText)) {
      throw new FenError("The side not to move is in check, which is impossible.");
    }
  }

  return { board, turn: turnText, castling, enPassant, halfmove, fullmove };
}

/**
 * @param {PositionState} state
 * @returns {string} FEN string describing `state`.
 */
export function toFen(state) {
  const ranks = [];
  for (let rank = 7; rank >= 0; rank -= 1) {
    let text = "";
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = state.board[toIndex(file, rank)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        text += String(empty);
        empty = 0;
      }
      text += piece;
    }
    if (empty > 0) {
      text += String(empty);
    }
    ranks.push(text);
  }

  const enPassant = state.enPassant === -1 ? "-" : toName(state.enPassant);
  return [ranks.join("/"), state.turn, formatCastling(state.castling), enPassant, state.halfmove, state.fullmove].join(
    " ",
  );
}

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is a structurally valid, playable FEN.
 */
export function isValidFen(value) {
  try {
    parseFen(String(value));
    return true;
  } catch {
    return false;
  }
}
