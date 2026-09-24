/**
 * Explains a rejected UCI without changing move generation. The Position's legal
 * set is authoritative; these geometry checks only name the most useful reason
 * when the candidate is absent. No separate rules engine is used for play.
 *
 * @module core/illegal-move
 */

import { CastlingRight } from "./fen.js";
import { MoveFlag, createMove, parseUci } from "./move.js";
import { colorOf, opposite } from "./pieces.js";
import { fileOf, rankOf, toIndex, toName } from "./squares.js";

export const IllegalReason = Object.freeze({
  MALFORMED: "malformed",
  REPEATED_MOVE: "repeated-move",
  EMPTY_SQUARE: "empty-square",
  OPPONENT_PIECE: "opponent-piece",
  DOES_NOT_MOVE_THAT_WAY: "does-not-move-that-way",
  BLOCKED: "blocked",
  LEAVES_KING_IN_CHECK: "leaves-king-in-check",
  CASTLE_RIGHTS: "castle-rights",
  CASTLE_BLOCKED: "castle-blocked",
  CASTLE_THROUGH_CHECK: "castle-through-check",
  EN_PASSANT_ILLEGAL: "en-passant-illegal",
  PROMOTION_REQUIRED: "promotion-required",
  PROMOTION_ILLEGAL: "promotion-illegal",
  NOT_IN_LEGAL_SET: "not-in-legal-set",
});

/**
 * @param {import('./position.js').Position} position
 * @param {unknown} uci
 * @returns {{code:string, facts:Record<string, string>}} stable reason and safe facts.
 */
export function explainIllegalMove(position, uci) {
  const parsed = parseUci(uci);
  const facts = { uci: String(uci ?? "").slice(0, 32) };
  const answer = (code, extra = {}) => ({ code, facts: { ...facts, ...extra } });
  if (!parsed) return answer(IllegalReason.MALFORMED);

  const { from, to, promotion } = parsed;
  const piece = position.pieceAt(from);
  const target = position.pieceAt(to);
  const fromName = toName(from);
  const toNameText = toName(to);
  Object.assign(facts, { from: fromName, to: toNameText, piece: piece || "" });

  if (!piece) return answer(IllegalReason.EMPTY_SQUARE);
  if (colorOf(piece) !== position.turn) return answer(IllegalReason.OPPONENT_PIECE);

  const kind = piece.toLowerCase();
  const df = fileOf(to) - fileOf(from);
  const dr = rankOf(to) - rankOf(from);
  const absFile = Math.abs(df);
  const absRank = Math.abs(dr);
  const promotes = kind === "p" && rankOf(to) === (position.turn === "w" ? 7 : 0);
  if (promotes && !promotion) return answer(IllegalReason.PROMOTION_REQUIRED);
  if (promotion && !promotes) return answer(IllegalReason.PROMOTION_ILLEGAL);

  if (kind === "k" && dr === 0 && absFile === 2) {
    const rank = position.turn === "w" ? 0 : 7;
    const kingSide = df > 0;
    const right =
      position.turn === "w"
        ? kingSide
          ? CastlingRight.WHITE_KING
          : CastlingRight.WHITE_QUEEN
        : kingSide
          ? CastlingRight.BLACK_KING
          : CastlingRight.BLACK_QUEEN;
    const rookSquare = toIndex(kingSide ? 7 : 0, rank);
    if (
      from !== toIndex(4, rank) ||
      (position.castlingRights & right) === 0 ||
      position.pieceAt(rookSquare) !== (position.turn === "w" ? "R" : "r")
    ) {
      return answer(IllegalReason.CASTLE_RIGHTS);
    }
    const emptyFiles = kingSide ? [5, 6] : [1, 2, 3];
    const blocker = emptyFiles.find((file) => position.pieceAt(toIndex(file, rank)));
    if (blocker !== undefined) return answer(IllegalReason.CASTLE_BLOCKED, { blocker: toName(toIndex(blocker, rank)) });
    const crossedFiles = kingSide ? [4, 5, 6] : [4, 3, 2];
    if (crossedFiles.some((file) => position.isSquareAttackedBy(toIndex(file, rank), opposite(position.turn)))) {
      return answer(IllegalReason.CASTLE_THROUGH_CHECK);
    }
    return answer(IllegalReason.NOT_IN_LEGAL_SET);
  }

  if (target && colorOf(target) === position.turn) return answer(IllegalReason.BLOCKED, { blocker: toNameText });

  let shapeIsValid = false;
  let flags = target ? MoveFlag.CAPTURE : MoveFlag.NORMAL;
  if (kind === "p") {
    const direction = position.turn === "w" ? 1 : -1;
    const startRank = position.turn === "w" ? 1 : 6;
    if (df === 0 && dr === direction) {
      shapeIsValid = !target;
      if (target) return answer(IllegalReason.BLOCKED, { blocker: toNameText });
    } else if (df === 0 && dr === direction * 2 && rankOf(from) === startRank) {
      const middle = toIndex(fileOf(from), rankOf(from) + direction);
      if (position.pieceAt(middle) || target) {
        return answer(IllegalReason.BLOCKED, { blocker: toName(position.pieceAt(middle) ? middle : to) });
      }
      shapeIsValid = true;
      flags = MoveFlag.BIG_PAWN;
    } else if (absFile === 1 && dr === direction) {
      if (target) shapeIsValid = true;
      else if (position.enPassantSquare === to && position.pieceAt(toIndex(fileOf(to), rankOf(from)))) {
        shapeIsValid = true;
        flags = MoveFlag.EN_PASSANT;
      } else return answer(IllegalReason.EN_PASSANT_ILLEGAL);
    }
  } else if (kind === "n") {
    shapeIsValid = (absFile === 1 && absRank === 2) || (absFile === 2 && absRank === 1);
  } else if (kind === "k") {
    shapeIsValid = Math.max(absFile, absRank) === 1;
  } else if (kind === "r" || kind === "b" || kind === "q") {
    const straight = (df === 0 || dr === 0) && (df !== 0 || dr !== 0);
    const diagonal = absFile === absRank && absFile !== 0;
    shapeIsValid = kind === "r" ? straight : kind === "b" ? diagonal : straight || diagonal;
    if (shapeIsValid) {
      const fileStep = Math.sign(df);
      const rankStep = Math.sign(dr);
      const steps = Math.max(absFile, absRank);
      for (let index = 1; index < steps; index += 1) {
        const square = toIndex(fileOf(from) + fileStep * index, rankOf(from) + rankStep * index);
        if (position.pieceAt(square)) return answer(IllegalReason.BLOCKED, { blocker: toName(square) });
      }
    }
  }
  if (!shapeIsValid) return answer(IllegalReason.DOES_NOT_MOVE_THAT_WAY);

  if (promotes) flags |= MoveFlag.PROMOTION;
  // The real generator is authoritative. This clone is used ONLY to explain
  // a pseudo-legal move that would expose the mover's king (pins, EP, checks).
  const move = createMove({ from, to, promotion, flags });
  const copy = position.clone();
  try {
    copy.makeMove(move, { validate: false });
    if (copy.isCheck(position.turn)) return answer(IllegalReason.LEAVES_KING_IN_CHECK);
  } catch {
    // An unexpected geometry mismatch cannot grant a move legality.
  }
  return answer(IllegalReason.NOT_IN_LEGAL_SET);
}

/** A single plain sentence for the English-language chat protocol (not UI). */
export function illegalReasonSentence({ code, facts = {} }) {
  const square = facts.from || "the origin";
  switch (code) {
    case IllegalReason.MALFORMED:
      return "The coordinate move is malformed.";
    case IllegalReason.REPEATED_MOVE:
      return "That move was already rejected in this position; choose a different legal move.";
    case IllegalReason.EMPTY_SQUARE:
      return `The origin ${square} is empty.`;
    case IllegalReason.OPPONENT_PIECE:
      return `The piece on ${square} belongs to the other side.`;
    case IllegalReason.DOES_NOT_MOVE_THAT_WAY:
      return `That piece cannot move from ${square} to ${facts.to}.`;
    case IllegalReason.BLOCKED:
      return `The path is blocked at ${facts.blocker || facts.to}.`;
    case IllegalReason.LEAVES_KING_IN_CHECK:
      return "That move would leave your king in check.";
    case IllegalReason.CASTLE_RIGHTS:
      return "Castling rights or the required rook are missing.";
    case IllegalReason.CASTLE_BLOCKED:
      return `Castling is blocked at ${facts.blocker || facts.to}.`;
    case IllegalReason.CASTLE_THROUGH_CHECK:
      return "The king cannot castle out of, through, or into check.";
    case IllegalReason.EN_PASSANT_ILLEGAL:
      return "There is no legal en passant capture on that square.";
    case IllegalReason.PROMOTION_REQUIRED:
      return "A pawn reaching the last rank must specify q, r, b, or n.";
    case IllegalReason.PROMOTION_ILLEGAL:
      return "A promotion suffix is only allowed on a pawn move to the last rank.";
    default:
      return "That move is not in the legal set for this position.";
  }
}
