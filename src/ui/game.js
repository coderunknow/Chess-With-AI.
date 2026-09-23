/**
 * Game session: position, move history, turn ownership and persistence.
 *
 * This is the model layer of the side panel. It contains no DOM access, which
 * keeps the turn/retry/undo rules unit-testable and lets the view stay a thin
 * renderer.
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

/** Snapshot format version, bumped when the persisted shape changes. */
export const SNAPSHOT_VERSION = 1;

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
 */

/**
 * @typedef {object} MoveResult
 * @property {boolean} ok
 * @property {string} code one of {@link MoveError} when `ok` is false.
 * @property {string} error human-readable message.
 * @property {MoveEntry} [entry] the move that was applied.
 * @property {import('../core/position.js').Outcome} [outcome]
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
      plies += 1;
    }

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
    this.#waitingForAi = this.#position.turn !== this.#playerColor;
    this.#retryCount = 0;
    this.#rejectedMoves.clear();
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
    for (const move of parsed.moves) {
      const san = toSan(this.#position, move);
      this.#applyMove(move, san, MoveSource.IMPORT);
    }
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
   * @returns {object} a JSON-safe snapshot for `chrome.storage.local`.
   */
  snapshot() {
    return {
      version: SNAPSHOT_VERSION,
      initialFen: this.#initialFen,
      playerColor: this.#playerColor,
      moves: this.#history.map((entry) => entry.uci),
      result: this.result,
    };
  }

  /**
   * Rebuilds a session from {@link GameSession#snapshot}. Corrupt snapshots
   * degrade to a fresh game instead of throwing.
   *
   * @param {unknown} snapshot
   * @param {object} [options]
   * @param {'w'|'b'} [options.playerColor] fallback when the snapshot is unusable.
   * @returns {GameSession}
   */
  static fromSnapshot(snapshot, { playerColor = Color.WHITE } = {}) {
    const data = typeof snapshot === "object" && snapshot !== null ? snapshot : null;
    if (!data || data.version !== SNAPSHOT_VERSION || !Array.isArray(data.moves)) {
      return new GameSession({ playerColor });
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
        session.reset({ playerColor: session.playerColor });
        break;
      }
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

  /**
   * @param {string} uci
   * @param {'human'|'ai'} source
   * @returns {MoveResult}
   */
  #play(uci, source) {
    const parsed = parseUci(uci);
    if (!parsed) {
      return failure(MoveError.ILLEGAL, `"${String(uci)}" is not a valid move.`);
    }

    const move = this.#position.moveFromUci(uci);
    if (!move) {
      return failure(MoveError.ILLEGAL, `[${parsed.from}${parsed.to}] is not legal in this position.`);
    }

    const san = toSan(this.#position, move);
    const entry = this.#applyMove(move, san, source);
    this.#waitingForAi = source === MoveSource.HUMAN && this.#position.turn !== this.#playerColor;
    if (source === MoveSource.AI) {
      this.#retryCount = 0;
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
    this.#position.makeMove(move, { validate: false });
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
    };
    this.#history.push(entry);
    return entry;
  }
}

/**
 * @param {string} code
 * @param {string} error
 * @returns {MoveResult}
 */
function failure(code, error) {
  return { ok: false, code, error };
}
