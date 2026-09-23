/**
 * Public API of the chess core.
 *
 * Everything under `src/core` is a pure, dependency-free ES module that runs
 * identically in Node (tests) and in the extension (side panel, content
 * script). Nothing in here may touch the DOM or the `chrome` namespace.
 *
 * @module core
 */

export { Position, DEFAULT_PROMOTION, FIFTY_MOVE_PLIES, THREEFOLD_REPETITIONS } from "./position.js";
export {
  CastlingRight,
  FenError,
  START_FEN,
  formatCastling,
  isValidFen,
  parseCastling,
  parseFen,
  toFen,
} from "./fen.js";
export { MoveFlag, createMove, equals, isCapture, isCastle, isPromotion, isValidUci, parseUci, toUci } from "./move.js";
export {
  Color,
  PIECE_GLYPHS,
  PIECE_NAMES,
  PieceType,
  PROMOTION_PIECES,
  colorOf,
  isPiece,
  isWhitePiece,
  opposite,
  pieceOf,
  typeOf,
} from "./pieces.js";
export {
  BOARD_SIZE,
  FILES,
  RANKS,
  SQUARE_COUNT,
  fileOf,
  isLightSquare,
  isValidName,
  offset,
  parseSquare,
  rankOf,
  toIndex,
  toName,
} from "./squares.js";
export { KNIGHT_MOVES, KING_MOVES, isSquareAttacked, isSlidingPiece, pawnAttacks } from "./attacks.js";
export { PGN_RESULT, formatPgn, moveFromSan, normaliseSanToken, parsePgn, pgnToUciMoves, toSan } from "./pgn.js";
export { computeZobristKey, updateZobristKey } from "./zobrist.js";
export { evaluate, formatEval, classifyMove, MATERIAL } from "./eval.js";
export { Searcher, findBestMove, MATE_SCORE, INF } from "./search.js";
