/**
 * Chess position: board state, move generation, legality and game outcome.
 *
 * The class is a pure model with no DOM or extension API dependency, which
 * makes it directly unit-testable under Node (`node --test`).
 *
 * @module core/position
 */

import { DIAGONAL_RAYS, KING_MOVES, KNIGHT_MOVES, ORTHOGONAL_RAYS, isSquareAttacked, pawnAttacks } from "./attacks.js";
import { START_FEN, CastlingRight, parseFen, toFen } from "./fen.js";
import { MoveFlag, createMove, equals, isCapture, isPromotion, parseUci } from "./move.js";
import { Color, PROMOTION_PIECES, opposite, pieceOf } from "./pieces.js";
import { fileOf, rankOf, toIndex } from "./squares.js";

/** Promotion piece used when a caller does not specify one. */
export const DEFAULT_PROMOTION = "q";

/** Halfmove clock value that ends the game through the fifty-move rule. */
export const FIFTY_MOVE_PLIES = 100;

/** Repetitions required for the threefold-repetition draw. */
export const THREEFOLD_REPETITIONS = 3;

const QUEEN_RAYS = Object.freeze([...ORTHOGONAL_RAYS, ...DIAGONAL_RAYS]);

const KING_START = Object.freeze({ w: toIndex(4, 0), b: toIndex(4, 7) });

/**
 * `CASTLING_MASK[square]` clears the rights that are lost when a piece leaves
 * or lands on that square.
 * @type {readonly number[]}
 */
const CASTLING_MASK = (() => {
  const mask = new Array(64).fill(CastlingRight.ALL);
  mask[toIndex(0, 0)] &= ~CastlingRight.WHITE_QUEEN;
  mask[toIndex(7, 0)] &= ~CastlingRight.WHITE_KING;
  mask[toIndex(0, 7)] &= ~CastlingRight.BLACK_QUEEN;
  mask[toIndex(7, 7)] &= ~CastlingRight.BLACK_KING;
  mask[KING_START.w] &= ~(CastlingRight.WHITE_KING | CastlingRight.WHITE_QUEEN);
  mask[KING_START.b] &= ~(CastlingRight.BLACK_KING | CastlingRight.BLACK_QUEEN);
  return Object.freeze(mask);
})();

/**
 * Castling geometry per color: which right is required, where the rook goes,
 * which squares must be empty, and which square the king crosses (the
 * destination square is validated by the generic legality filter).
 */
const CASTLING_GEOMETRY = Object.freeze({
  w: Object.freeze({
    kingSide: Object.freeze({
      right: CastlingRight.WHITE_KING,
      kingTo: toIndex(6, 0),
      rookFrom: toIndex(7, 0),
      rookTo: toIndex(5, 0),
      empty: Object.freeze([toIndex(5, 0), toIndex(6, 0)]),
      safe: Object.freeze([toIndex(5, 0)]),
    }),
    queenSide: Object.freeze({
      right: CastlingRight.WHITE_QUEEN,
      kingTo: toIndex(2, 0),
      rookFrom: toIndex(0, 0),
      rookTo: toIndex(3, 0),
      empty: Object.freeze([toIndex(1, 0), toIndex(2, 0), toIndex(3, 0)]),
      safe: Object.freeze([toIndex(3, 0)]),
    }),
  }),
  b: Object.freeze({
    kingSide: Object.freeze({
      right: CastlingRight.BLACK_KING,
      kingTo: toIndex(6, 7),
      rookFrom: toIndex(7, 7),
      rookTo: toIndex(5, 7),
      empty: Object.freeze([toIndex(5, 7), toIndex(6, 7)]),
      safe: Object.freeze([toIndex(5, 7)]),
    }),
    queenSide: Object.freeze({
      right: CastlingRight.BLACK_QUEEN,
      kingTo: toIndex(2, 7),
      rookFrom: toIndex(0, 7),
      rookTo: toIndex(3, 7),
      empty: Object.freeze([toIndex(1, 7), toIndex(2, 7), toIndex(3, 7)]),
      safe: Object.freeze([toIndex(3, 7)]),
    }),
  }),
});

/**
 * @typedef {object} Undo
 * @property {import('./move.js').Move} move
 * @property {string} piece piece that moved.
 * @property {string} captured captured piece, `''` when quiet.
 * @property {number} capturedSquare square the captured piece came from.
 * @property {number} castling previous castling-rights mask.
 * @property {number} enPassant previous en-passant square.
 * @property {number} halfmove previous halfmove clock.
 * @property {number} fullmove previous fullmove number.
 */

/**
 * @typedef {object} Outcome
 * @property {boolean} over whether the game has finished.
 * @property {'1-0'|'0-1'|'1/2-1/2'|'*'} result PGN-style result token.
 * @property {'playing'|'checkmate'|'stalemate'|'fifty-move'|'insufficient-material'|'threefold-repetition'} reason
 * @property {'w'|'b'|null} winner winning color, or null for a draw.
 */

const OUTCOME_PLAYING = Object.freeze({
  over: false,
  result: "*",
  reason: "playing",
  winner: null,
});

export class Position {
  /** @type {string[]} */
  #board;
  /** @type {'w'|'b'} */
  #turn;
  #castling;
  #enPassant;
  #halfmove;
  #fullmove;
  /** @type {string[]} position keys used for repetition detection. */
  #keys;
  /** @type {Undo[]} */
  #undoStack;

  /**
   * Use {@link Position.start} or {@link Position.fromFen} instead.
   * @param {import('./fen.js').PositionState} state
   */
  constructor(state) {
    this.#board = [...state.board];
    this.#turn = state.turn;
    this.#castling = state.castling;
    this.#enPassant = state.enPassant;
    this.#halfmove = state.halfmove;
    this.#fullmove = state.fullmove;
    this.#undoStack = [];
    this.#keys = [this.#computeKey()];
  }

  /**
   * @returns {Position} the standard starting position.
   */
  static start() {
    return Position.fromFen(START_FEN);
  }

  /**
   * @param {string} fen
   * @param {object} [options] forwarded to {@link parseFen}.
   * @returns {Position}
   */
  static fromFen(fen, options) {
    return new Position(parseFen(fen, options));
  }

  /**
   * @returns {Position} an independent copy of this position.
   */
  clone() {
    const copy = new Position({
      board: this.#board,
      turn: this.#turn,
      castling: this.#castling,
      enPassant: this.#enPassant,
      halfmove: this.#halfmove,
      fullmove: this.#fullmove,
    });
    copy.#keys = [...this.#keys];
    return copy;
  }

  /** @returns {'w'|'b'} side to move. */
  get turn() {
    return this.#turn;
  }

  /** @returns {number} halfmove clock, in plies. */
  get halfmoveClock() {
    return this.#halfmove;
  }

  /** @returns {number} fullmove number, starting at 1. */
  get fullmoveNumber() {
    return this.#fullmove;
  }

  /** @returns {number} en-passant target square index, or -1 when unavailable. */
  get enPassantSquare() {
    return this.#enPassant;
  }

  /** @returns {number} castling-rights bitmask. */
  get castlingRights() {
    return this.#castling;
  }

  /** @returns {number} number of plies that can still be unmade. */
  get plyCount() {
    return this.#undoStack.length;
  }

  /**
   * @param {number} square
   * @returns {string} piece character, or `''` for an empty square.
   */
  pieceAt(square) {
    return this.#board[square] || "";
  }

  /** @returns {string[]} a defensive copy of the 64-square board. */
  boardSnapshot() {
    return [...this.#board];
  }

  /**
   * @param {'w'|'b'} color
   * @returns {number} king square index, or -1 when no king is present.
   */
  kingSquare(color) {
    return this.#board.indexOf(color === Color.WHITE ? "K" : "k");
  }

  /**
   * @param {number} square
   * @param {'w'|'b'} byColor
   * @returns {boolean} true when `byColor` attacks `square`.
   */
  isSquareAttackedBy(square, byColor) {
    return isSquareAttacked(this.#board, square, byColor);
  }

  /**
   * @param {'w'|'b'} [color] defaults to the side to move.
   * @returns {boolean} true when `color`'s king is attacked.
   */
  isCheck(color = this.#turn) {
    const square = this.kingSquare(color);
    return square !== -1 && isSquareAttacked(this.#board, square, opposite(color));
  }

  /**
   * @param {import('./move.js').Move} move
   * @returns {boolean} true when `move` is correctly shaped for this position.
   */
  isCandidateMove(move) {
    if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to)) {
      return false;
    }
    const piece = this.#board[move.from];
    if (!piece || piece !== pieceOf(this.#turn, piece.toLowerCase())) {
      return false;
    }
    return this.#generateMoves(move.from).some(
      (candidate) => equals(candidate, move) && candidate.flags === move.flags,
    );
  }

  /**
   * @param {import('./move.js').Move} move
   * @returns {boolean} true when `move` is legal (never leaves the king in check).
   */
  isLegalMove(move) {
    if (!this.isCandidateMove(move)) {
      return false;
    }
    const mover = this.#turn;
    const undo = this.#apply(move);
    const legal = !this.isCheck(mover);
    this.#revert(undo);
    return legal;
  }

  /**
   * @param {number} square
   * @returns {import('./move.js').Move[]} legal moves originating from `square`.
   */
  legalMovesFrom(square) {
    const mover = this.#turn;
    const piece = this.#board[square];
    if (!piece || piece !== pieceOf(mover, piece.toLowerCase())) return [];
    return this.#generateMoves(square).filter((move) => {
      const undo = this.#apply(move);
      const legal = !this.isCheck(mover);
      this.#revert(undo);
      return legal;
    });
  }

  /**
   * @returns {import('./move.js').Move[]} every legal move in this position.
   */
  legalMoves() {
    const mover = this.#turn;
    const candidates = [];
    for (let square = 0; square < 64; square += 1) {
      const piece = this.#board[square];
      if (piece && piece === pieceOf(mover, piece.toLowerCase())) {
        this.#generateMoves(square, candidates);
      }
    }

    return candidates.filter((move) => {
      const undo = this.#apply(move);
      const legal = !this.isCheck(mover);
      this.#revert(undo);
      return legal;
    });
  }

  /**
   * Resolves UCI text into a legal move. When the notation omits a promotion
   * piece, the default promotion (queen) is used.
   *
   * @param {string} uci
   * @returns {import('./move.js').Move|null} the matching legal move.
   */
  moveFromUci(uci) {
    const parsed = parseUci(uci);
    if (!parsed) {
      return null;
    }

    const candidates = this.legalMovesFrom(parsed.from);
    const exact = candidates.find((move) => move.to === parsed.to && move.promotion === parsed.promotion);
    if (exact) {
      return exact;
    }
    if (parsed.promotion === "") {
      return candidates.find((move) => move.to === parsed.to && move.promotion === DEFAULT_PROMOTION) || null;
    }
    return null;
  }

  /**
   * Applies a move and records it for {@link Position#unmakeMove}.
   *
   * @param {import('./move.js').Move} move
   * @param {object} [options]
   * @param {boolean} [options.validate] when true (default) the move must be legal.
   * @returns {Undo|null} the undo record, or null when the move was rejected.
   */
  makeMove(move, { validate = true } = {}) {
    if (validate && !this.isLegalMove(move)) {
      return null;
    }
    const undo = this.#apply(move);
    this.#undoStack.push(undo);
    this.#keys.push(this.#computeKey());
    return undo;
  }

  /**
   * Reverts the most recent move.
   *
   * @returns {Undo|null} the undone record, or null when there is nothing to undo.
   */
  unmakeMove() {
    const undo = this.#undoStack.pop();
    if (!undo) {
      return null;
    }
    this.#revert(undo);
    this.#keys.pop();
    return undo;
  }

  /** @returns {boolean} true when the side to move is checkmated. */
  isCheckmate() {
    return this.isCheck() && this.legalMoves().length === 0;
  }

  /** @returns {boolean} true when the side to move has no legal move and is not in check. */
  isStalemate() {
    return !this.isCheck() && this.legalMoves().length === 0;
  }

  /** @returns {boolean} true when neither side can mate by any legal sequence. */
  isInsufficientMaterial() {
    let knights = 0;
    let bishops = 0;
    const bishopSquareColors = new Set();

    for (let square = 0; square < 64; square += 1) {
      const piece = this.#board[square];
      switch (piece.toLowerCase()) {
        case "p":
        case "r":
        case "q":
          return false;
        case "n":
          knights += 1;
          break;
        case "b":
          bishops += 1;
          bishopSquareColors.add((fileOf(square) + rankOf(square)) % 2 === 0 ? "dark" : "light");
          break;
        default:
          break;
      }
    }

    if (knights === 0 && bishops === 0) {
      return true; // king vs king
    }
    if (knights === 1 && bishops === 0) {
      return true; // king and knight vs king
    }
    if (bishops === 1 && knights === 0) {
      return true; // king and bishop vs king
    }
    if (knights === 0 && bishops > 1 && bishopSquareColors.size === 1) {
      return true; // bishops that all stay on one square colour
    }
    return false;
  }

  /** @returns {boolean} true when the fifty-move rule has been reached. */
  isFiftyMoveDraw() {
    return this.#halfmove >= FIFTY_MOVE_PLIES;
  }

  /**
   * @returns {number} how many times the current position has occurred.
   */
  repetitionCount() {
    const key = this.#computeKey();
    let count = 0;
    for (const previous of this.#keys) {
      if (previous === key) {
        count += 1;
      }
    }
    return count;
  }

  /** @returns {boolean} true when the current position occurred at least three times. */
  isThreefoldRepetition() {
    return this.repetitionCount() >= THREEFOLD_REPETITIONS;
  }

  /**
   * @returns {Outcome} the current game state under automatic draw rules.
   */
  outcome() {
    const moves = this.legalMoves();
    if (moves.length === 0) {
      if (this.isCheck()) {
        const winner = opposite(this.#turn);
        return {
          over: true,
          result: winner === Color.WHITE ? "1-0" : "0-1",
          reason: "checkmate",
          winner,
        };
      }
      return { over: true, result: "1/2-1/2", reason: "stalemate", winner: null };
    }

    if (this.isFiftyMoveDraw()) {
      return { over: true, result: "1/2-1/2", reason: "fifty-move", winner: null };
    }
    if (this.isInsufficientMaterial()) {
      return { over: true, result: "1/2-1/2", reason: "insufficient-material", winner: null };
    }
    if (this.isThreefoldRepetition()) {
      return { over: true, result: "1/2-1/2", reason: "threefold-repetition", winner: null };
    }
    return { ...OUTCOME_PLAYING };
  }

  /**
   * @returns {string} position key for repetition detection. The en-passant
   *   file only counts when a capture is actually available, per FIDE rules.
   */
  key() {
    return this.#computeKey();
  }

  /** @returns {string} current FEN. */
  toFen() {
    return toFen({
      board: this.#board,
      turn: this.#turn,
      castling: this.#castling,
      enPassant: this.#enPassant,
      halfmove: this.#halfmove,
      fullmove: this.#fullmove,
    });
  }

  /** @returns {string} the FEN of the current position. */
  toString() {
    return this.toFen();
  }

  #computeKey() {
    return `${this.#board.join("")}|${this.#turn}|${this.#castling}|${this.#enPassantKey()}`;
  }

  #enPassantKey() {
    if (this.#enPassant === -1) {
      return "-";
    }
    const pawn = pieceOf(this.#turn, "p");
    const rankDelta = this.#turn === Color.WHITE ? -1 : 1;
    for (const fileDelta of [-1, 1]) {
      const source = toIndex(fileOf(this.#enPassant) + fileDelta, rankOf(this.#enPassant) + rankDelta);
      if (source !== -1 && this.#board[source] === pawn) {
        return String(this.#enPassant);
      }
    }
    return "-";
  }

  /**
   * @param {number} square
   * @param {import('./move.js').Move[]} [moves] accumulator.
   * @returns {import('./move.js').Move[]} rule-shaped (candidate) moves.
   */
  #generateMoves(square, moves = []) {
    const piece = this.#board[square];
    if (!piece) {
      return moves;
    }
    const color = piece === piece.toUpperCase() ? Color.WHITE : Color.BLACK;

    switch (piece.toLowerCase()) {
      case "p":
        this.#generatePawnMoves(square, color, moves);
        break;
      case "n":
        this.#generateStepMoves(square, color, KNIGHT_MOVES[square], moves);
        break;
      case "b":
        this.#generateSlidingMoves(square, color, DIAGONAL_RAYS, moves);
        break;
      case "r":
        this.#generateSlidingMoves(square, color, ORTHOGONAL_RAYS, moves);
        break;
      case "q":
        this.#generateSlidingMoves(square, color, QUEEN_RAYS, moves);
        break;
      case "k":
        this.#generateKingMoves(square, color, moves);
        break;
      default:
        break;
    }
    return moves;
  }

  #generatePawnMoves(square, color, moves) {
    const direction = color === Color.WHITE ? 1 : -1;
    const startRank = color === Color.WHITE ? 1 : 6;
    const promotionRank = color === Color.WHITE ? 7 : 0;
    const origin = { file: fileOf(square), rank: rankOf(square) };

    const oneStep = toIndex(origin.file, origin.rank + direction);
    if (oneStep !== -1 && !this.#board[oneStep]) {
      this.#addPawnMove(moves, square, oneStep, rankOf(oneStep) === promotionRank, MoveFlag.NORMAL);

      if (origin.rank === startRank) {
        const twoStep = toIndex(origin.file, origin.rank + direction * 2);
        if (twoStep !== -1 && !this.#board[twoStep]) {
          moves.push(createMove({ from: square, to: twoStep, flags: MoveFlag.BIG_PAWN }));
        }
      }
    }

    for (const target of pawnAttacks(square, color)) {
      const targetPiece = this.#board[target];
      if (targetPiece) {
        const isEnemy = targetPiece !== pieceOf(color, targetPiece.toLowerCase());
        if (isEnemy) {
          this.#addPawnMove(moves, square, target, rankOf(target) === promotionRank, MoveFlag.CAPTURE);
        }
        continue;
      }
      if (target === this.#enPassant) {
        moves.push(createMove({ from: square, to: target, flags: MoveFlag.EN_PASSANT }));
      }
    }
  }

  #addPawnMove(moves, from, to, promotes, flags) {
    if (!promotes) {
      moves.push(createMove({ from, to, flags }));
      return;
    }
    for (const promotion of PROMOTION_PIECES) {
      moves.push(createMove({ from, to, promotion, flags: flags | MoveFlag.PROMOTION }));
    }
  }

  #generateStepMoves(square, color, targets, moves) {
    for (const target of targets) {
      const occupant = this.#board[target];
      if (occupant && occupant === pieceOf(color, occupant.toLowerCase())) {
        continue;
      }
      moves.push(createMove({ from: square, to: target, flags: occupant ? MoveFlag.CAPTURE : MoveFlag.NORMAL }));
    }
  }

  #generateSlidingMoves(square, color, rays, moves) {
    for (const ray of rays) {
      for (const target of ray[square]) {
        const occupant = this.#board[target];
        if (!occupant) {
          moves.push(createMove({ from: square, to: target }));
          continue;
        }
        if (occupant !== pieceOf(color, occupant.toLowerCase())) {
          moves.push(createMove({ from: square, to: target, flags: MoveFlag.CAPTURE }));
        }
        break;
      }
    }
  }

  #generateKingMoves(square, color, moves) {
    this.#generateStepMoves(square, color, KING_MOVES[square], moves);

    if (square !== KING_START[color] || this.isCheck(color)) {
      return;
    }

    for (const side of ["kingSide", "queenSide"]) {
      const geometry = CASTLING_GEOMETRY[color][side];
      if ((this.#castling & geometry.right) === 0) {
        continue;
      }
      if (this.#board[geometry.rookFrom] !== pieceOf(color, "r")) {
        continue;
      }
      if (!geometry.empty.every((target) => !this.#board[target])) {
        continue;
      }
      if (!geometry.safe.every((target) => !isSquareAttacked(this.#board, target, opposite(color)))) {
        continue;
      }
      moves.push(
        createMove({
          from: square,
          to: geometry.kingTo,
          flags: side === "kingSide" ? MoveFlag.KING_CASTLE : MoveFlag.QUEEN_CASTLE,
        }),
      );
    }
  }

  /**
   * Applies a move without validating it. The move must come from this
   * position's generator.
   *
   * @param {import('./move.js').Move} move
   * @returns {Undo}
   */
  #apply(move) {
    const piece = this.#board[move.from];
    const color = piece === piece.toUpperCase() ? Color.WHITE : Color.BLACK;

    /** @type {Undo} */
    const undo = {
      move,
      piece,
      captured: "",
      capturedSquare: -1,
      castling: this.#castling,
      enPassant: this.#enPassant,
      halfmove: this.#halfmove,
      fullmove: this.#fullmove,
    };

    if (isCapture(move)) {
      const capturedSquare =
        (move.flags & MoveFlag.EN_PASSANT) !== 0 ? toIndex(fileOf(move.to), rankOf(move.from)) : move.to;
      undo.captured = this.#board[capturedSquare];
      undo.capturedSquare = capturedSquare;
      this.#board[capturedSquare] = "";
    }

    this.#board[move.from] = "";
    this.#board[move.to] = isPromotion(move) ? pieceOf(color, move.promotion) : piece;

    if (move.flags & MoveFlag.KING_CASTLE) {
      const geometry = CASTLING_GEOMETRY[color].kingSide;
      this.#board[geometry.rookTo] = this.#board[geometry.rookFrom];
      this.#board[geometry.rookFrom] = "";
    } else if (move.flags & MoveFlag.QUEEN_CASTLE) {
      const geometry = CASTLING_GEOMETRY[color].queenSide;
      this.#board[geometry.rookTo] = this.#board[geometry.rookFrom];
      this.#board[geometry.rookFrom] = "";
    }

    this.#castling &= CASTLING_MASK[move.from] & CASTLING_MASK[move.to];
    this.#enPassant =
      (move.flags & MoveFlag.BIG_PAWN) !== 0
        ? toIndex(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2)
        : -1;

    this.#halfmove = piece.toLowerCase() === "p" || isCapture(move) ? 0 : this.#halfmove + 1;
    if (color === Color.BLACK) {
      this.#fullmove += 1;
    }
    this.#turn = opposite(color);
    return undo;
  }

  /**
   * @param {Undo} undo
   */
  #revert(undo) {
    const move = undo.move;
    const color = undo.piece === undo.piece.toUpperCase() ? Color.WHITE : Color.BLACK;

    if (move.flags & MoveFlag.KING_CASTLE) {
      const geometry = CASTLING_GEOMETRY[color].kingSide;
      this.#board[geometry.rookFrom] = this.#board[geometry.rookTo];
      this.#board[geometry.rookTo] = "";
    } else if (move.flags & MoveFlag.QUEEN_CASTLE) {
      const geometry = CASTLING_GEOMETRY[color].queenSide;
      this.#board[geometry.rookFrom] = this.#board[geometry.rookTo];
      this.#board[geometry.rookTo] = "";
    }

    this.#board[move.to] = "";
    this.#board[move.from] = undo.piece;
    if (undo.captured) {
      this.#board[undo.capturedSquare] = undo.captured;
    }

    this.#castling = undo.castling;
    this.#enPassant = undo.enPassant;
    this.#halfmove = undo.halfmove;
    this.#fullmove = undo.fullmove;
    this.#turn = color;
  }
}

export { CastlingRight };
