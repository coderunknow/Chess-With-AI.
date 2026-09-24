/**
 * Game session: position, move history, turn ownership and persistence — v2.
 *
 * This is the model layer of the side panel. It contains no DOM access, which
 * keeps the turn/retry/undo rules unit-testable and lets the view stay a thin
 * renderer.
 *
 * v0.2.0 changes:
 * - Snapshot version 2 with finalFen and migration from v0.1.0
 * - Replay viewer: jump to ply, forward/back, start/end, current move highlight
 * - Play from any position, retry from here
 * - FEN setup with validation
 * - Move classification and analysis support (heuristic)
 * - Corrupt records handling
 *
 * @module ui/game
 */

import { START_FEN } from "../core/fen.js";
import { parseUci, toUci } from "../core/move.js";
import { Color, colorOf, opposite } from "../core/pieces.js";
import { Position } from "../core/position.js";
import { toName } from "../core/squares.js";
import { formatPgn, parsePgn, toSan } from "../core/pgn.js";
import { formatMoveList } from "../shared/prompt.js";
import { evaluate, classifyMove } from "../core/eval.js";
import { explainIllegalMove, IllegalReason } from "../core/illegal-move.js";
import { rankOf } from "../core/squares.js";

/** Snapshot format version, bumped when the persisted shape changes. */
export const SNAPSHOT_VERSION = 2;

/** Where a move came from. */
export const MoveSource = Object.freeze({
  HUMAN: "human",
  AI: "ai",
  IMPORT: "import",
});

/** Machine-readable failure codes returned by the session. */
export const MoveError = Object.freeze({
  GAME_OVER: "game-over",
  NOT_YOUR_TURN: "not-your-turn",
  NOT_AI_TURN: "not-ai-turn",
  ILLEGAL: "illegal",
  INVALID_FEN: "invalid-fen",
});

/**
 * @typedef {object} MoveEntry
 * @property {string} uci
 * @property {string} san
 * @property {string} from algebraic square.
 * @property {string} to algebraic square.
 * @property {string} promotion
 * @property {'w'|'b'} color mover.
 * @property {'human'|'ai'|'import'} source
 * @property {string} fenAfter
 * @property {boolean} check
 * @property {boolean} mate
 * @property {string} [comment] PGN comment
 * @property {number} [evalBefore] eval before move (white perspective)
 * @property {number} [evalAfter] eval after move
 * @property {'brilliant'|'good'|'inaccuracy'|'mistake'|'blunder'|''} [classification]
 */

/**
 * @typedef {object} MoveResult
 * @property {boolean} ok
 * @property {string} code one of {@link MoveError} when `ok` is false.
 * @property {string} error human-readable message.
 * @property {MoveEntry} [entry] the move that was applied.
 * @property {import('../core/position.js').Outcome} [outcome]
 * @property {{code:string, facts:Record<string,string>}} [reason] explanation on ILLEGAL.
 */

export class GameSession {
  /** @type {Position} */
  #position;
  /** @type {MoveEntry[]} */
  #history = [];
  /** @type {'w'|'b'} */
  #playerColor;
  /** @type {string} */
  #initialFen;
  #waitingForAi = false;
  #retryCount = 0;
  /** @type {Set<string>} */
  #rejectedMoves = new Set();
  #currentPly = 0; // for replay viewer, 0 = start, history.length = latest
  #positionAtPly = []; // cached positions for replay

  /**
   * @param {object} [options]
   * @param {'w'|'b'} [options.playerColor] side played by the human.
   * @param {string} [options.initialFen] non-standard starting position.
   */
  constructor({ playerColor = Color.WHITE, initialFen = START_FEN } = {}) {
    this.#playerColor = playerColor === Color.BLACK ? Color.BLACK : Color.WHITE;
    this.#initialFen = initialFen;
    this.#position = Position.fromFen(initialFen);
    this.#waitingForAi = this.#position.turn !== this.#playerColor;
    this.#currentPly = 0;
    this.#positionAtPly = [this.#position.clone()];
  }

  /** @returns {string} current FEN. */
  get fen() {
    return this.#position.toFen();
  }

  /** @returns {string} the FEN the game started from. */
  get initialFen() {
    return this.#initialFen;
  }

  /** @returns {'w'|'b'} side to move. */
  get turn() {
    return this.#position.turn;
  }

  /** @returns {'w'|'b'} side the human plays. */
  get playerColor() {
    return this.#playerColor;
  }

  /** @returns {'w'|'b'} side the AI plays. */
  get aiColor() {
    return opposite(this.#playerColor);
  }

  /** @returns {boolean} true when the human may move. */
  get isPlayerTurn() {
    return this.#position.turn === this.#playerColor;
  }

  /** @returns {boolean} true when a prompt is out and the AI owes a move. */
  get isWaitingForAi() {
    return this.#waitingForAi;
  }

  /** @returns {boolean} true when the human has no legal move and is in check. */
  get isCheck() {
    return this.#position.isCheck();
  }

  /** @returns {import('../core/position.js').Outcome} */
  get outcome() {
    return this.#position.outcome();
  }

  /** @returns {boolean} */
  get isGameOver() {
    return this.outcome.over;
  }

  /** @returns {'1-0'|'0-1'|'1/2-1/2'|'*'} */
  get result() {
    return this.outcome.result;
  }

  /** @returns {ReadonlyArray<MoveEntry>} the move history, oldest first. */
  get history() {
    return [...this.#history];
  }

  /** @returns {MoveEntry|null} the most recent move. */
  get lastMove() {
    return this.#history.at(-1) || null;
  }

  /** @returns {number} plies played. */
  get plyCount() {
    return this.#history.length;
  }

  /** @returns {number} how many retry prompts were sent for the current move. */
  get retryCount() {
    return this.#retryCount;
  }

  /** @returns {string[]} moves the AI produced that were rejected as illegal. */
  get rejectedMoves() {
    return [...this.#rejectedMoves];
  }

  /** @returns {import('../core/position.js').Position} read-only access for the view. */
  get position() {
    return this.#position;
  }

  /** @returns {number} current ply for replay viewer (0 = start) */
  get currentPly() {
    return this.#currentPly;
  }

  /** @returns {boolean} can go back */
  get canGoBack() {
    return this.#currentPly > 0;
  }

  /** @returns {boolean} can go forward */
  get canGoForward() {
    return this.#currentPly < this.#history.length;
  }

  /** @returns {MoveEntry|null} move at current replay position */
  get currentMove() {
    if (this.#currentPly === 0) return null;
    return this.#history[this.#currentPly - 1] || null;
  }

  /**
   * @param {number} square
   * @returns {string[]} algebraic names of the legal destinations.
   */
  legalTargets(square) {
    return this.#position.legalMovesFrom(square).map((move) => toName(move.to));
  }

  /**
   * @param {number} square
   * @returns {boolean} true when the square holds a piece the player may move.
   */
  canSelect(square) {
    const piece = this.#position.pieceAt(square);
    return Boolean(piece) && colorOf(piece) === this.#playerColor;
  }

  /**
   * Plays the human's move.
   *
   * @param {string} uci
   * @returns {MoveResult}
   */
  playHumanMove(uci) {
    if (this.isGameOver) {
      return failure(MoveError.GAME_OVER, "The game is already over. Start a new game to keep playing.");
    }
    if (!this.isPlayerTurn) {
      return failure(MoveError.NOT_YOUR_TURN, "Wait for the AI to answer before making another move.");
    }
    // If replay viewer is not at end, truncate future moves (play from here)
    if (this.#currentPly < this.#history.length) {
      this.#truncateToPly(this.#currentPly);
    }
    return this.#play(uci, MoveSource.HUMAN);
  }

  /**
   * Plays the AI's move.
   *
   * @param {string} uci
   * @returns {MoveResult}
   */
  playAiMove(uci) {
    if (this.isGameOver) {
      return failure(MoveError.GAME_OVER, "The game is already over.");
    }
    if (this.isPlayerTurn) {
      return failure(MoveError.NOT_AI_TURN, "The AI replied out of turn; the move was ignored.");
    }
    if (this.#currentPly < this.#history.length) {
      this.#truncateToPly(this.#currentPly);
    }
    return this.#play(uci, MoveSource.AI);
  }

  /**
   * Applies the first playable move from a set of candidates, which is how the
   * panel handles an AI reply that contains more than one bracketed move.
   *
   * @param {ReadonlyArray<string>} candidates UCI moves, newest first.
   * @returns {MoveResult}
   */
  playFirstAvailable(candidates) {
    if (this.isGameOver) {
      return failure(MoveError.GAME_OVER, "The game is already over.");
    }
    if (this.isPlayerTurn) {
      return failure(MoveError.NOT_AI_TURN, "The AI replied out of turn; the move was ignored.");
    }

    if (this.#currentPly < this.#history.length) {
      this.#truncateToPly(this.#currentPly);
    }

    let lastFailure = failure(MoveError.ILLEGAL, "The AI did not send a usable move.");
    for (const candidate of candidates) {
      const uci = typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
      if (!uci || this.#rejectedMoves.has(uci)) {
        continue;
      }
      const result = this.#play(uci, MoveSource.AI);
      if (result.ok) {
        return result;
      }
      if (result.code === MoveError.ILLEGAL) {
        this.#rejectedMoves.add(uci);
        lastFailure = result;
        continue;
      }
      return result;
    }
    return lastFailure;
  }

  /**
   * Records that a retry prompt was sent to the AI.
   *
   * @returns {number} the new retry count.
   */
  registerRetry() {
    this.#retryCount += 1;
    return this.#retryCount;
  }

  /**
   * Removes the last human move (and the AI's reply when one was played).
   *
   * @returns {{ok: boolean, plies: number, error: string}}
   */
  undo() {
    if (this.#history.length === 0) {
      return { ok: false, plies: 0, error: "There is nothing to undo yet." };
    }

    let plies = 0;
    while (this.#history.length > 0 && (plies === 0 || !this.isPlayerTurn)) {
      this.#position.unmakeMove();
      this.#history.pop();
      this.#positionAtPly.pop();
      plies += 1;
    }

    this.#currentPly = this.#history.length;
    this.#waitingForAi = false;
    this.#retryCount = 0;
    this.#rejectedMoves.clear();
    return { ok: true, plies, error: "" };
  }

  /**
   * Starts a new game.
   *
   * @param {object} [options]
   * @param {'w'|'b'} [options.playerColor] defaults to the current colour.
   * @param {string} [options.initialFen] defaults to the standard position.
   */
  reset({ playerColor = this.#playerColor, initialFen = START_FEN } = {}) {
    this.#playerColor = playerColor === Color.BLACK ? Color.BLACK : Color.WHITE;
    this.#initialFen = initialFen;
    this.#position = Position.fromFen(initialFen);
    this.#history = [];
    this.#positionAtPly = [this.#position.clone()];
    this.#currentPly = 0;
    this.#waitingForAi = this.#position.turn !== this.#playerColor;
    this.#retryCount = 0;
    this.#rejectedMoves.clear();
  }

  /**
   * Sets up a position from FEN, with validation.
   *
   * @param {string} fen
   * @returns {{ok:boolean, error:string}}
   */
  setFen(fen) {
    try {
      const pos = Position.fromFen(fen);
      this.#initialFen = pos.toFen();
      this.#position = pos;
      this.#history = [];
      this.#positionAtPly = [this.#position.clone()];
      this.#currentPly = 0;
      this.#waitingForAi = this.#position.turn !== this.#playerColor;
      this.#retryCount = 0;
      this.#rejectedMoves.clear();
      return { ok: true, error: "" };
    } catch (error) {
      return { ok: false, error: error.message || "Invalid FEN." };
    }
  }

  /**
   * Replays a PGN document, replacing the current game.
   *
   * @param {string} text
   * @returns {{ok: boolean, error: string, plies: number}}
   */
  loadPgn(text) {
    const parsed = parsePgn(text);
    if (parsed.moves.length === 0) {
      return { ok: false, error: parsed.error || "The PGN text contains no moves.", plies: 0 };
    }

    this.#initialFen = parsed.game.initialFen;
    this.#position = Position.fromFen(this.#initialFen);
    this.#history = [];
    this.#positionAtPly = [this.#position.clone()];
    for (const move of parsed.moves) {
      const san = toSan(this.#position, move);
      this.#applyMove(move, san, MoveSource.IMPORT);
    }
    this.#currentPly = this.#history.length;
    this.#waitingForAi = this.#position.turn !== this.#playerColor;
    this.#retryCount = 0;
    this.#rejectedMoves.clear();
    return { ok: true, error: parsed.error, plies: this.#history.length };
  }

  /**
   * @returns {string} the game as a PGN document.
   */
  toPgn() {
    return formatPgn({
      initialFen: this.#initialFen,
      san: this.#history.map((entry) => entry.san),
      result: this.result,
      headers: {
        White: this.#playerColor === Color.WHITE ? "Human" : "AI",
        Black: this.#playerColor === Color.BLACK ? "Human" : "AI",
      },
    });
  }

  /** @returns {string} the move list rendered as `1. e4 e5 2. Nf3`. */
  get moveListText() {
    return formatMoveList(this.#history, {
      startMoveNumber: Number.parseInt(this.#initialFen.split(/\s+/)[5] || "1", 10) || 1,
      blackToMoveFirst: (this.#initialFen.split(/\s+/)[1] || "w") === "b",
    });
  }

  /**
   * @returns {object} a JSON-safe snapshot for `chrome.storage.local` — v2.
   */
  snapshot() {
    return {
      version: SNAPSHOT_VERSION,
      initialFen: this.#initialFen,
      playerColor: this.#playerColor,
      moves: this.#history.map((entry) => entry.uci),
      result: this.result,
      finalFen: this.fen,
      currentPly: this.#currentPly,
    };
  }

  /**
   * Rebuilds a session from {@link GameSession#snapshot}. Corrupt snapshots
   * degrade to a fresh game instead of throwing. Supports migration from v1.
   *
   * @param {unknown} snapshot
   * @param {object} [options]
   * @param {'w'|'b'} [options.playerColor] fallback when the snapshot is unusable.
   * @returns {GameSession}
   */
  static fromSnapshot(snapshot, { playerColor = Color.WHITE } = {}) {
    const data = typeof snapshot === "object" && snapshot !== null ? snapshot : null;
    if (!data || !Array.isArray(data.moves)) {
      return new GameSession({ playerColor });
    }

    // Migration: v1 had version 1, v2 has version 2, but also handle missing version
    const version = data.version;
    if (version !== 1 && version !== 2) {
      // Try to recover as v1 if it has initialFen and moves
      if (!data.initialFen) {
        return new GameSession({ playerColor });
      }
    }

    let session;
    try {
      session = new GameSession({
        playerColor: data.playerColor === Color.BLACK ? Color.BLACK : playerColor,
        initialFen: typeof data.initialFen === "string" ? data.initialFen : START_FEN,
      });
    } catch {
      return new GameSession({ playerColor });
    }

    for (const uci of data.moves) {
      if (typeof uci !== "string" || !session.playAnyMove(uci)) {
        // Corrupt move — discard rest but keep valid prefix (v0.2.0 improvement)
        // Instead of resetting whole game, keep prefix
        break;
      }
    }

    // Restore currentPly if present (v2)
    if (typeof data.currentPly === "number" && data.currentPly >= 0 && data.currentPly <= session.#history.length) {
      session.#currentPly = data.currentPly;
      // Rebuild position to that ply
      try {
        const pos = Position.fromFen(session.#initialFen);
        for (let i = 0; i < session.#currentPly; i += 1) {
          const move = pos.moveFromUci(session.#history[i].uci);
          if (move) pos.makeMove(move, { validate: false });
        }
        session.#position = pos;
      } catch {
        session.#currentPly = session.#history.length;
      }
    } else {
      session.#currentPly = session.#history.length;
    }

    return session;
  }

  /**
   * Applies a move regardless of whose turn it is in the game record — used when
   * restoring a snapshot whose last move may have been the AI's.
   *
   * @param {string} uci
   * @returns {boolean} true when the move was applied.
   */
  playAnyMove(uci) {
    const parsed = parseUci(uci);
    if (!parsed) {
      return false;
    }
    const move = this.#position.moveFromUci(uci);
    if (!move) {
      return false;
    }
    const san = toSan(this.#position, move);
    const source = this.#position.turn === this.#playerColor ? MoveSource.HUMAN : MoveSource.AI;
    this.#applyMove(move, san, source);
    this.#waitingForAi = this.#position.turn !== this.#playerColor;
    return true;
  }

  // --- Replay viewer ---

  /**
   * Jumps to a specific ply (0 = start).
   *
   * @param {number} ply
   * @returns {boolean}
   */
  jumpToPly(ply) {
    if (ply < 0 || ply > this.#history.length) return false;
    if (ply === this.#currentPly) return true;

    // Rebuild from initial
    try {
      const pos = Position.fromFen(this.#initialFen);
      for (let i = 0; i < ply; i += 1) {
        const move = pos.moveFromUci(this.#history[i].uci);
        if (!move) return false;
        pos.makeMove(move, { validate: false });
      }
      this.#position = pos;
      this.#currentPly = ply;
      this.#waitingForAi = this.#position.turn !== this.#playerColor;
      return true;
    } catch {
      return false;
    }
  }

  /** @returns {boolean} */
  goToStart() {
    return this.jumpToPly(0);
  }

  /** @returns {boolean} */
  goToEnd() {
    return this.jumpToPly(this.#history.length);
  }

  /** @returns {boolean} */
  goBack() {
    if (!this.canGoBack) return false;
    return this.jumpToPly(this.#currentPly - 1);
  }

  /** @returns {boolean} */
  goForward() {
    if (!this.canGoForward) return false;
    return this.jumpToPly(this.#currentPly + 1);
  }

  /**
   * Truncates history to ply (for play from here).
   *
   * @param {number} ply
   */
  #truncateToPly(ply) {
    if (ply < 0 || ply > this.#history.length) return;
    this.#history = this.#history.slice(0, ply);
    this.#positionAtPly = this.#positionAtPly.slice(0, ply + 1);
    // Rebuild position to ply
    try {
      const pos = Position.fromFen(this.#initialFen);
      for (let i = 0; i < ply; i += 1) {
        const move = pos.moveFromUci(this.#history[i].uci);
        if (move) pos.makeMove(move, { validate: false });
      }
      this.#position = pos;
      this.#currentPly = ply;
    } catch {
      // ignore
    }
  }

  /**
   * Plays from any position — resets to current replay position as new initial.
   *
   * @returns {{ok:boolean, error:string}}
   */
  playFromHere() {
    if (this.#currentPly === this.#history.length) {
      return { ok: true, error: "" };
    }
    const newInitial = this.#position.toFen();
    // Keep history up to current ply as new game
    this.#initialFen = newInitial;
    this.#history = [];
    this.#positionAtPly = [this.#position.clone()];
    this.#currentPly = 0;
    this.#waitingForAi = this.#position.turn !== this.#playerColor;
    return { ok: true, error: "" };
  }

  /**
   * Retries from current replay position — truncates future moves.
   *
   * @returns {{ok:boolean, error:string}}
   */
  retryFromHere() {
    this.#truncateToPly(this.#currentPly);
    return { ok: true, error: "" };
  }

  /**
   * Analyses the game, producing accuracy and biggest swings.
   * Heuristic only.
   *
   * @returns {{accuracy:{white:number, black:number}, swings:Array, classifications:Map}}
   */
  analyseGame() {
    const classifications = [];
    let whiteTotal = 0;
    let whiteCount = 0;
    let blackTotal = 0;
    let blackCount = 0;
    const swings = [];

    try {
      const pos = Position.fromFen(this.#initialFen);
      let prevEval = evaluate(pos);

      for (let i = 0; i < this.#history.length; i += 1) {
        const entry = this.#history[i];
        const move = pos.moveFromUci(entry.uci);
        if (!move) break;

        const before = pos.turn === "w" ? prevEval : -prevEval;
        pos.makeMove(move, { validate: false });
        const afterEval = evaluate(pos);
        const after = pos.turn === "w" ? -afterEval : afterEval; // from mover perspective

        const classification = classifyMove(before, after);
        const swing = after - before;

        classifications.push({ ply: i + 1, uci: entry.uci, san: entry.san, classification, swing, color: entry.color });

        // Track accuracy (simplified: good moves = high accuracy)
        const accuracy =
          classification === "blunder"
            ? 0
            : classification === "mistake"
              ? 30
              : classification === "inaccuracy"
                ? 70
                : 100;
        if (entry.color === "w") {
          whiteTotal += accuracy;
          whiteCount += 1;
        } else {
          blackTotal += accuracy;
          blackCount += 1;
        }

        if (Math.abs(swing) > 150) {
          swings.push({ ply: i + 1, san: entry.san, swing, classification });
        }

        prevEval = afterEval;
      }

      swings.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));

      return {
        accuracy: {
          white: whiteCount > 0 ? Math.round(whiteTotal / whiteCount) : 0,
          black: blackCount > 0 ? Math.round(blackTotal / blackCount) : 0,
        },
        swings: swings.slice(0, 5),
        classifications,
      };
    } catch {
      return { accuracy: { white: 0, black: 0 }, swings: [], classifications: [] };
    }
  }

  /**
   * @param {string} uci
   * @param {'human'|'ai'} source
   * @returns {MoveResult}
   */
  #play(uci, source) {
    const parsed = parseUci(uci);
    if (!parsed) {
      return failure(
        MoveError.ILLEGAL,
        `"${String(uci)}" is not a valid move.`,
        explainIllegalMove(this.#position, uci),
      );
    }

    // Position.moveFromUci deliberately defaults an omitted promotion to a
    // queen for human/PGN convenience. The chat protocol requires the suffix.
    const piece = this.#position.pieceAt(parsed.from);
    const missingPromotion =
      source === MoveSource.AI &&
      piece?.toLowerCase() === "p" &&
      rankOf(parsed.to) === (this.#position.turn === "w" ? 7 : 0) &&
      !parsed.promotion;
    const move = missingPromotion ? null : this.#position.moveFromUci(uci);
    if (!move) {
      const reason = explainIllegalMove(this.#position, uci);
      return failure(
        MoveError.ILLEGAL,
        reason.code === IllegalReason.PROMOTION_REQUIRED
          ? "A promotion piece is required."
          : `[${uci}] is not legal in this position.`,
        reason,
      );
    }

    const san = toSan(this.#position, move);
    const entry = this.#applyMove(move, san, source);
    this.#currentPly = this.#history.length;
    this.#waitingForAi = source === MoveSource.HUMAN && this.#position.turn !== this.#playerColor;
    if (source === MoveSource.AI) {
      this.#retryCount = 0;
    } else if (source === MoveSource.HUMAN) {
      this.#rejectedMoves.clear(); // a new ply must never inherit an old rejection
    }
    return { ok: true, code: "", error: "", entry, outcome: this.#position.outcome() };
  }

  /**
   * @param {import('../core/move.js').Move} move
   * @param {string} san
   * @param {'human'|'ai'|'import'} source
   * @returns {MoveEntry}
   */
  #applyMove(move, san, source) {
    const beforeEval = evaluate(this.#position);
    this.#position.makeMove(move, { validate: false });
    const afterEval = evaluate(this.#position);
    const beforeFromMover = this.#position.turn === Color.WHITE ? -beforeEval : beforeEval;
    const afterFromMover = this.#position.turn === Color.WHITE ? -afterEval : afterEval;
    const classification = classifyMove(beforeFromMover, afterFromMover);

    /** @type {MoveEntry} */
    const entry = {
      uci: toUci(move),
      san,
      from: toName(move.from),
      to: toName(move.to),
      promotion: move.promotion,
      color: this.#position.turn === Color.WHITE ? Color.BLACK : Color.WHITE,
      source,
      fenAfter: this.#position.toFen(),
      check: this.#position.isCheck(),
      mate: this.#position.isCheckmate(),
      evalBefore: beforeEval,
      evalAfter: afterEval,
      classification,
    };
    this.#history.push(entry);
    this.#positionAtPly.push(this.#position.clone());
    return entry;
  }
}

/**
 * @param {string} code
 * @param {string} error
 * @returns {MoveResult}
 */
function failure(code, error, reason = undefined) {
  return { ok: false, code, error, ...(reason ? { reason } : {}) };
}
