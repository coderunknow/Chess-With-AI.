/**
 * Side-panel application — v0.2.0.
 *
 * Owns the state machine that ties the chess session, the AI chat tab and the
 * DOM together, plus all v0.2.0 features:
 * - Board drag & drop, hover, animations, sounds, hint arrow, eval bar
 * - Game library (list, open, rename, duplicate, delete with undo)
 * - PGN import/export (file, clipboard, textarea) + replay viewer
 * - FEN paste with validation, copy position
 * - i18n (en/vi), themes (light/dark/system), board themes, font scale, density
 * - Diagnostics (platform, matched selectors, timings, copy report)
 * - Clock (optional), sounds (WebAudio, off by default)
 * - Analysis (local engine Worker, hint, eval, classification, accuracy report, play vs engine)
 * - Keyboard shortcuts + help dialog
 * - Focus management, a11y announcements, badge turn/check sync, theme flash fix
 * - Storage migration v2, quota-aware, corrupt discard
 *
 * The view is rebuilt from {@link App#render} on every state change; all
 * rendering models come from pure helpers.
 *
 * @module ui/app
 */

import { PIECE_GLYPHS, PIECE_NAMES, colorOf } from "../core/pieces.js";
import { toName } from "../core/squares.js";
import { createLogger } from "../shared/log.js";
import { MessageType, createMessage, describeRuntimeError, normaliseResponse } from "../shared/messaging.js";
import { PLATFORMS, platformForUrl } from "../shared/platforms.js";
import { buildMovePrompt, buildOpeningPrompt, buildRetryPrompt } from "../shared/prompt.js";
import { DEFAULT_SETTINGS, SETTINGS_KEY, mergeSettings, resolveTheme, resolveLocale } from "../shared/settings.js";
import { readValue, removeValue, writeValue } from "../shared/storage.js";
import { createTranslator } from "../shared/i18n.js";
import { formatReport } from "../shared/diagnostics.js";
import { playSound } from "../shared/sounds.js";
import { createClock, startClock, stopClock, tickClock, formatClock } from "../shared/clock.js";
import {
  LAST_DELETED_KEY,
  readLibrary,
  writeLibrary,
  addGame,
  updateGame,
  deleteGame,
  duplicateGame,
  gameFromSnapshot,
} from "../shared/game-library.js";
import { BoardView, describeBoard, squaresOfUci } from "./board.js";
import { GameSession, MoveError } from "./game.js";
import { HistoryView } from "./history.js";
import { StatusAction, describeStatus } from "./status.js";
import { evaluate, formatEval } from "../core/eval.js";

const log = createLogger("panel");

/** Storage key for the running game. */
export const GAME_KEY = "game";

/** Phase of the prompt state machine. */
export const Phase = Object.freeze({
  IDLE: "idle",
  SENDING: "sending",
  AWAITING: "awaiting",
  ERROR: "error",
});

const CONTENT_SCRIPT_FILE = "src/content/index.js";

export class App {
  /** @type {GameSession} */
  #session;
  /** @type {import('../shared/settings.js').Settings} */
  #settings = { ...DEFAULT_SETTINGS };
  /** @type {import('./board.js').BoardView} */
  #boardView;
  /** @type {import('./history.js').HistoryView} */
  #historyView;
  /** @type {{supported: boolean, platform: string, label: string, tabId: number|null, url: string}} */
  #connection = { supported: false, platform: "", label: "", tabId: null, url: "" };
  #phase = Phase.IDLE;
  #message = "";
  #selected = -1;
  #targets = [];
  #flipOverride = null;
  #persistTimer = 0;
  #refs;
  #t = null;
  #locale = "en";
  #busy = false;
  #lastGameSnapshot = null;
  #lastDeletedGame = null;
  #undoDeleteTimer = 0;
  #diagnostics = null;
  #clockState = null;
  #clockTimer = 0;
  #engineWorker = null;
  #engineLevel = 4;
  #hintMove = null;
  #evalScore = null;
  #library = null;
  #librarySearch = "";
  #renameTargetId = null;
  #announceTimer = 0;
  #lastPrompt = "";
  #retryBackoffTimer = 0;

  /**
   * @param {object} refs DOM references resolved by `main.js`.
   */
  constructor(refs) {
    this.#refs = refs;
    this.#session = new GameSession();
    this.#boardView = new BoardView(refs.board, {
      onSelect: (square) => void this.selectSquare(square),
      onDrop: (from, to) => void this.handleDrop(from, to),
    });
    this.#historyView = new HistoryView({
      list: refs.moveList,
      empty: refs.moveListEmpty,
      onSelectPly: (ply) => this.jumpToPly(ply),
    });
    this.#bindEvents();
    this.#renderPlatformOptions();
    this.#initI18n();
    this.#initClock();
    this.#initEngine();
  }

  /** @returns {GameSession} the active session (read-only use). */
  get session() {
    return this.#session;
  }

  #initI18n() {
    try {
      const resolved = resolveLocale(this.#settings.locale);
      this.#locale = resolved;
      this.#t = createTranslator(resolved);
    } catch {
      this.#t = createTranslator("en");
      this.#locale = "en";
    }
    // Use #locale to satisfy lint and set document lang when DOM available
    try {
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.lang = this.#locale;
      }
    } catch {
      // ignore
    }
  }

  /** @returns {string} current locale */
  get locale() {
    return this.#locale;
  }

  #initClock() {
    this.#clockState = createClock();
  }

  #initEngine() {
    try {
      if (typeof Worker !== "undefined") {
        const workerUrl = new URL("../core/search-worker.js", import.meta.url);
        this.#engineWorker = new Worker(workerUrl, { type: "module" });
        this.#engineWorker.onmessage = (event) => this.#handleEngineMessage(event);
        log.info("engine worker ready");
      }
    } catch (error) {
      log.warn("engine worker not available", error);
      this.#engineWorker = null;
    }
  }

  #handleEngineMessage(event) {
    const data = event.data;
    if (!data) return;
    if (data.type === "info") {
      this.#evalScore = data.score;
      this.#renderEval();
    } else if (data.type === "result") {
      if (data.move) {
        const uci = `${toName(data.move.from)}${toName(data.move.to)}${data.move.promotion || ""}`;
        this.#hintMove = { from: data.move.from, to: data.move.to };
        this.#evalScore = data.score;
        this.#render();
        this.#announce(`Best move ${uci}, eval ${formatEval(data.score).text}`);
      }
      this.#setEngineBusy(false);
    } else if (data.type === "error") {
      log.warn("engine error", data.error);
      this.#setEngineBusy(false);
    }
  }

  #setEngineBusy(busy) {
    this.#busy = busy;
    if (this.#refs.controls.stopEngine) {
      this.#refs.controls.stopEngine.hidden = !busy;
    }
    if (this.#refs.controls.playVsEngine) {
      this.#refs.controls.playVsEngine.disabled = busy;
    }
  }

  /**
   * Restores settings and the previous game, then performs the first render.
   *
   * @returns {Promise<void>}
   */
  async start() {
    // Load settings
    this.#settings = mergeSettings(await readValue(SETTINGS_KEY, {}));
    this.#engineLevel = Number(this.#settings.engineLevel) || 4;

    // Apply theme immediately and cache to localStorage to prevent flash
    this.#applyTheme();
    this.#cacheTheme();

    // Init i18n with resolved locale
    const effectiveLocale = resolveLocale(this.#settings.locale);
    this.#locale = effectiveLocale;
    this.#t = createTranslator(effectiveLocale);
    this.#applyI18n();

    // Load library
    try {
      this.#library = await readLibrary();
    } catch {
      this.#library = { version: 2, games: [] };
    }

    // Restore game snapshot with migration
    const snapshot = await readValue(GAME_KEY, null);
    if (this.#settings.persistGame && snapshot) {
      this.#session = GameSession.fromSnapshot(snapshot, { playerColor: this.#settings.playerColor });
      log.info(`restored a game with ${this.#session.plyCount} plies (v${snapshot.version || 1}→v2)`);
    } else {
      this.#session = new GameSession({ playerColor: this.#settings.playerColor });
    }

    this.#applySettingsToDialog();
    this.#render();
    this.#renderLibrary();
    await this.refreshConnection();

    // Listen for system theme changes when theme=system
    try {
      const media = window.matchMedia("(prefers-color-scheme: light)");
      media.addEventListener?.("change", () => {
        if (this.#settings.theme === "system") {
          this.#applyTheme();
        }
      });
    } catch {
      // ignore
    }

    // Start clock tick if enabled
    if (this.#settings.clockEnabled) {
      this.#startClockTick();
    }
  }

  #cacheTheme() {
    try {
      const cache = {
        theme: this.#settings.theme,
        boardTheme: this.#settings.boardTheme,
        fontScale: this.#settings.fontScale,
        density: this.#settings.density,
      };
      localStorage.setItem("ai-chess-companion-theme-cache", JSON.stringify(cache));
    } catch {
      // ignore
    }
  }

  #applyTheme() {
    const resolved = resolveTheme(this.#settings.theme);
    document.body.dataset.theme = resolved;
    document.body.dataset.boardTheme = this.#settings.boardTheme;
    document.body.dataset.fontScale = this.#settings.fontScale;
    document.body.dataset.density = this.#settings.density;
  }

  #applyI18n() {
    if (!this.#t) return;
    const t = this.#t;
    // Update static UI text via textContent (never innerHTML)
    const setText = (id, key, params) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = t(key, params);
      }
    };
    setText("app-title", "app.title");
    setText("app-eyebrow", "app.eyebrow");
    setText("turn-label", "app.title"); // fallback
    // We keep many labels static for v0.2.0 but ensure t() is used for dynamic status
  }

  /**
   * Re-reads which tab the panel should talk to.
   *
   * @returns {Promise<void>}
   */
  async refreshConnection() {
    try {
      const response = await chrome.runtime.sendMessage(createMessage(MessageType.GET_ACTIVE_TAB));
      this.#setConnection(response);
      // Try to get diagnostics if available
      if (response?.tabId) {
        try {
          const diag = await chrome.tabs.sendMessage(response.tabId, { type: "GET_DIAGNOSTICS" });
          if (diag?.report) {
            this.#diagnostics = diag.report;
            this.#renderDiagnostics();
          }
        } catch {
          // ignore, content script may not have diagnostics yet
        }
      }
    } catch (error) {
      log.debug("could not read the active tab", describeRuntimeError(error));
      this.#setConnection(null);
    }
    this.#render();
  }

  /**
   * Plays the human's move, or updates the selection.
   *
   * @param {number} square
   * @returns {Promise<void>}
   */
  async selectSquare(square) {
    if (this.#busy) {
      log.debug("busy, ignoring selectSquare");
      return;
    }

    const session = this.#session;

    if (session.isGameOver) {
      this.#message = this.#t ? this.#t("status.gameOverNew") : "The game is over — start a new game to keep playing.";
      this.#render();
      return;
    }

    if (!session.isPlayerTurn) {
      this.#message = this.#t ? this.#t("status.aiTurn") : "It is the AI's turn.";
      this.#render();
      return;
    }

    const name = toName(square);
    if (this.#selected !== -1 && this.#targets.includes(name)) {
      await this.#playHumanMove(this.#selected, square);
      return;
    }

    if (this.#selected === square) {
      this.#clearSelection();
      this.#render();
      return;
    }

    if (!session.canSelect(square)) {
      this.#clearSelection();
      this.#message = session.position.pieceAt(square)
        ? this.#t
          ? this.#t("status.aiBelongs")
          : "That piece belongs to the AI."
        : this.#t
          ? this.#t("status.selectPiece")
          : "Select one of your pieces first.";
      this.#render();
      return;
    }

    const targets = session.legalTargets(square);
    this.#selected = square;
    this.#targets = targets;
    this.#message =
      targets.length === 0 ? (this.#t ? this.#t("status.noLegalMoves") : "That piece has no legal moves.") : "";
    this.#render();
    this.#boardView.focus(square);
  }

  async handleDrop(from, to) {
    if (this.#busy) return;
    const session = this.#session;
    if (session.isGameOver || !session.isPlayerTurn) return;
    if (!session.canSelect(from)) return;
    const targets = session.legalTargets(from);
    const toNameStr = toName(to);
    if (!targets.includes(toNameStr)) {
      this.#message = this.#t ? this.#t("status.noLegalMoves") : "That move is not legal.";
      this.#render();
      return;
    }
    await this.#playHumanMove(from, to);
  }

  /**
   * @param {{move?: string, candidates?: string[], diagnostics?:object, text?:string, noMove?:boolean}} payload
   * @returns {Promise<void>}
   */
  async handleAiMove(payload) {
    const session = this.#session;
    if (session.isGameOver) {
      return;
    }

    // Handle plan reply with no move
    if (payload.noMove) {
      log.info("AI replied with no move, asking again with stricter instruction");
      const canRetry = this.#settings.autoRetry && session.retryCount < this.#settings.maxRetries;
      if (!canRetry) {
        this.#phase = Phase.ERROR;
        this.#message = this.#t
          ? this.#t("status.illegalAi", { move: "no move" })
          : "The AI did not send a move. Ask again with a stricter instruction.";
        this.#render();
        return;
      }
      const attempt = session.registerRetry();
      const strictPrompt = `${this.#movePrompt()}\n\nIMPORTANT: Reply with exactly one move in square brackets, like [e7e5]. Put the bracketed move first. Do not explain.`;
      await this.#sendPrompt(strictPrompt, { expected: "ai-move", retry: attempt });
      return;
    }

    if (payload.diagnostics) {
      this.#diagnostics = payload.diagnostics;
      this.#renderDiagnostics();
    }

    const candidates = normaliseCandidates(payload);
    if (candidates.length === 0) {
      return;
    }

    const result = session.playFirstAvailable(candidates);
    if (result.ok) {
      log.info(`AI played ${result.entry.uci} (${result.entry.san})`);
      this.#phase = Phase.IDLE;
      this.#message = "";
      this.#clearSelection();
      this.#hintMove = null;
      this.#persist();
      this.#render();
      this.#updateBadge();
      this.#playSoundForMove(result.entry);
      this.#updateClockAfterMove();
      this.#announceMove(result.entry);
      return;
    }

    if (result.code === MoveError.NOT_AI_TURN) {
      this.#message = `Ignored [${candidates[0]}]: it is your turn.`;
      this.#render();
      return;
    }

    if (result.code === MoveError.ILLEGAL) {
      await this.#retryAfterIllegalMove(candidates[0]);
    }
  }

  #playSoundForMove(entry) {
    if (!this.#settings.soundEnabled) return;
    try {
      if (entry.mate) {
        playSound("gameOver");
      } else if (entry.check) {
        playSound("check");
      } else if (entry.uci.includes("x") || entry.san.includes("x")) {
        playSound("capture");
      } else {
        playSound("move");
      }
    } catch {
      // ignore
    }
  }

  #updateClockAfterMove() {
    if (!this.#settings.clockEnabled || !this.#clockState) return;
    // Stop previous, start next
    this.#clockState = stopClock(this.#clockState);
    this.#clockState = startClock(this.#clockState, this.#session.turn);
    this.#renderClock();
  }

  #startClockTick() {
    if (this.#clockTimer) clearInterval(this.#clockTimer);
    this.#clockTimer = window.setInterval(() => {
      if (!this.#clockState?.running) return;
      this.#clockState = tickClock(this.#clockState);
      this.#renderClock();
      if (this.#clockState.whiteMs <= 0 || this.#clockState.blackMs <= 0) {
        this.#message = "Flag — time is up.";
        this.#render();
        clearInterval(this.#clockTimer);
      }
    }, 250);
  }

  #renderClock() {
    if (!this.#refs.clock?.root) return;
    if (!this.#settings.clockEnabled) {
      this.#refs.clock.root.hidden = true;
      return;
    }
    this.#refs.clock.root.hidden = false;
    if (this.#refs.clock?.whiteTime) {
      this.#refs.clock.whiteTime.textContent = formatClock(this.#clockState.whiteMs);
    }
    if (this.#refs.clock?.blackTime) {
      this.#refs.clock.blackTime.textContent = formatClock(this.#clockState.blackMs);
    }
    if (this.#refs.clock?.white) {
      this.#refs.clock.white.classList.toggle("is-active", this.#clockState.running === "w");
    }
    if (this.#refs.clock?.black) {
      this.#refs.clock.black.classList.toggle("is-active", this.#clockState.running === "b");
    }
  }

  #announce(text) {
    if (!this.#refs.announcements) return;
    this.#refs.announcements.textContent = "";
    clearTimeout(this.#announceTimer);
    this.#announceTimer = window.setTimeout(() => {
      this.#refs.announcements.textContent = text;
    }, 50);
  }

  #announceMove(entry) {
    const color = entry.color === "w" ? "White" : "Black";
    this.#announce(`${color} played ${entry.san}, ${entry.uci}`);
  }

  /**
   * Asks the AI to move in the current position. Used when the player takes
   * Black, after a page reload, and by the "ask again" action.
   *
   * @returns {Promise<void>}
   */
  async requestAiMove() {
    if (this.#busy) return;
    if (this.#session.isGameOver || this.#session.isPlayerTurn) {
      return;
    }
    const prompt =
      this.#session.plyCount === 0
        ? buildOpeningPrompt({ aiColor: this.#session.aiColor, fen: this.#session.fen })
        : this.#movePrompt();
    this.#lastPrompt = prompt;
    await this.#sendPrompt(prompt, { expected: "ai-move" });
  }

  /** Starts a new game with the configured colour. */
  resetGame() {
    // Store for undo
    this.#lastGameSnapshot = this.#session.snapshot();
    this.#session.reset({ playerColor: this.#settings.playerColor });
    this.#flipOverride = null;
    this.#clearSelection();
    this.#phase = Phase.IDLE;
    this.#message = this.#t ? this.#t("status.newGame") + ". Good luck!" : "New game. Good luck!";
    this.#hintMove = null;
    this.#evalScore = null;
    this.#persist();
    this.#render();
    this.#updateBadge();
    this.#showUndoDelete("Game reset — Undo", () => this.undoDeleteGame());
  }

  undoDeleteGame() {
    if (!this.#lastGameSnapshot) return;
    this.#session = GameSession.fromSnapshot(this.#lastGameSnapshot, { playerColor: this.#settings.playerColor });
    this.#lastGameSnapshot = null;
    this.#message = "Game restored.";
    this.#persist();
    this.#render();
    this.#updateBadge();
  }

  /** Undoes the last move pair. */
  undo() {
    if (this.#busy) return;
    const result = this.#session.undo();
    this.#phase = Phase.IDLE;
    this.#clearSelection();
    this.#hintMove = null;
    this.#message = result.ok
      ? this.#t
        ? this.#t("status.undo", { count: result.plies })
        : `Took back ${result.plies} ${result.plies === 1 ? "ply" : "plies"}.`
      : result.error;
    this.#persist();
    this.#render();
    this.#updateBadge();
  }

  /** @returns {string} the current game as PGN. */
  toPgn() {
    return this.#session.toPgn();
  }

  /**
   * Loads a PGN document into the session.
   *
   * @param {string} text
   * @returns {{ok: boolean, error: string}}
   */
  loadPgn(text) {
    const result = this.#session.loadPgn(text);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    this.#phase = Phase.IDLE;
    this.#clearSelection();
    this.#message = `Loaded ${result.plies} plies${result.error ? ` (${result.error})` : ""}.`;
    this.#persist();
    this.#render();
    this.#updateBadge();
    return { ok: true, error: result.error };
  }

  /**
   * Applies a settings patch and persists it.
   *
   * @param {Partial<import('../shared/settings.js').Settings>} patch
   * @returns {Promise<void>}
   */
  async updateSettings(patch) {
    const previous = this.#settings;
    this.#settings = mergeSettings(patch, this.#settings);
    this.#engineLevel = Number(this.#settings.engineLevel) || 4;
    this.#applySettingsToDialog();
    this.#applyTheme();
    this.#cacheTheme();
    this.#applyI18n();
    await writeValue(SETTINGS_KEY, this.#settings);

    if (previous.playerColor !== this.#settings.playerColor) {
      this.#flipOverride = null;
      this.#session.reset({ playerColor: this.#settings.playerColor });
      this.#message =
        this.#settings.playerColor === "w"
          ? "You play White from now on. New game started."
          : "You play Black from now on. New game started — ask the AI to open.";
      this.#phase = Phase.IDLE;
      this.#persist();
    }

    if (!this.#settings.persistGame) {
      await removeValue(GAME_KEY);
    }

    if (previous.clockEnabled !== this.#settings.clockEnabled) {
      if (this.#settings.clockEnabled) {
        this.#clockState = createClock();
        this.#startClockTick();
      } else {
        clearInterval(this.#clockTimer);
        this.#clockTimer = 0;
      }
    }

    if (previous.locale !== this.#settings.locale) {
      const effective = resolveLocale(this.#settings.locale);
      this.#locale = effective;
      this.#t = createTranslator(effective);
      this.#applyI18n();
    }

    this.#render();
    this.#renderClock();
  }

  /** @returns {'w'|'b'} the colour the human plays. */
  get playerColor() {
    return this.#session.playerColor;
  }

  /**
   * @param {number} from
   * @param {number} to
   * @returns {Promise<void>}
   */
  async #playHumanMove(from, to) {
    if (this.#busy) return;
    const session = this.#session;
    const promotions = session.position.legalMovesFrom(from).filter((move) => move.to === to && move.promotion);

    let promotion = "";
    if (promotions.length > 0) {
      promotion = await this.#askPromotionPiece(session.position.pieceAt(from));
      if (!promotion) {
        this.#message = this.#t ? this.#t("status.promotionCancelled") : "Promotion cancelled.";
        this.#render();
        return;
      }
    }

    const uci = `${toName(from)}${toName(to)}${promotion}`;
    const result = session.playHumanMove(uci);
    if (!result.ok) {
      this.#message = result.error;
      this.#phase = Phase.ERROR;
      this.#render();
      return;
    }

    this.#clearSelection();
    this.#message = "";
    this.#persist();
    this.#updateBadge();
    this.#playSoundForMove(result.entry);
    this.#updateClockAfterMove();
    this.#announceMove(result.entry);

    if (session.isGameOver) {
      this.#phase = Phase.IDLE;
      this.#render();
      return;
    }

    this.#lastPrompt = this.#movePrompt();
    await this.#sendPrompt(this.#lastPrompt, { expected: "ai-move" });
  }

  /** @returns {string} a move request for the current position. */
  #movePrompt() {
    const session = this.#session;
    const last = session.lastMove;
    return buildMovePrompt({
      fen: session.fen,
      uci: last?.uci || "",
      san: last?.san || "",
      aiColor: session.aiColor,
      history: session.moveListText,
    });
  }

  /**
   * @param {string} illegalMove
   * @returns {Promise<void>}
   */
  async #retryAfterIllegalMove(illegalMove) {
    const session = this.#session;
    const canRetry = this.#settings.autoRetry && session.retryCount < this.#settings.maxRetries;

    if (!canRetry) {
      this.#phase = Phase.ERROR;
      this.#message = this.#t
        ? this.#t("status.illegalAi", { move: illegalMove })
        : `The AI answered [${illegalMove}], which is not legal here. Ask again or adjust the position.`;
      this.#render();
      return;
    }

    const attempt = session.registerRetry();
    log.info(`asking the AI again (attempt ${attempt})`);
    const prompt = buildRetryPrompt({
      fen: session.fen,
      uci: illegalMove,
      aiColor: session.aiColor,
      history: session.moveListText,
    });

    // Bounded backoff: 500ms, 1s, 2s
    const backoff = Math.min(500 * Math.pow(2, attempt - 1), 2000);
    clearTimeout(this.#retryBackoffTimer);
    await new Promise((resolve) => {
      this.#retryBackoffTimer = window.setTimeout(resolve, backoff);
    });

    await this.#sendPrompt(prompt, { expected: "ai-move", retry: attempt });
  }

  /**
   * Injects a prompt into the active AI tab.
   *
   * @param {string} prompt
   * @param {object} [options]
   * @param {string} [options.expected] diagnostic label for the request.
   * @param {number} [options.retry] retry attempt number.
   * @returns {Promise<boolean>} true when the tab accepted the prompt.
   */
  async #sendPrompt(prompt, { expected = "prompt", retry = 0 } = {}) {
    if (this.#busy) {
      log.debug("already sending, ignoring");
      return false;
    }

    if (!this.#connection.supported || !Number.isInteger(this.#connection.tabId)) {
      log.debug("no supported AI tab is active; the prompt was not sent");
      this.#phase = Phase.IDLE;
      this.#message = this.#t ? this.#t("status.noAi") : "No AI chat detected.";
      this.#render();
      // Show copy prompt fallback
      this.#showCopyPrompt(prompt);
      return false;
    }

    this.#busy = true;
    this.#phase = Phase.SENDING;
    this.#message =
      retry > 0
        ? this.#t
          ? this.#t("status.retrying", { attempt: retry })
          : `Asking the AI again (attempt ${retry})…`
        : "";
    this.#render();

    try {
      const tabId = /** @type {number} */ (this.#connection.tabId);
      await this.#ensureContentScript(tabId);
      const response = normaliseResponse(
        await chrome.tabs.sendMessage(tabId, createMessage(MessageType.SEND_CHESS_PROMPT, { prompt, expected })),
      );

      if (!response.ok) {
        this.#phase = Phase.ERROR;
        this.#message = response.error;
        this.#diagnostics = response.diagnostics || null;
        this.#renderDiagnostics();
        // Show copy prompt if composer missing
        if (response.error.toLowerCase().includes("input box") || response.error.toLowerCase().includes("composer")) {
          this.#showCopyPrompt(prompt);
        }
        this.#render();
        return false;
      }

      this.#phase = Phase.AWAITING;
      this.#message = "";
      this.#diagnostics = response.diagnostics || this.#diagnostics;
      this.#renderDiagnostics();
      this.#busy = false;
      this.#render();
      return true;
    } catch (error) {
      const detail = describeRuntimeError(error) || String(error);
      this.#phase = Phase.ERROR;
      this.#message = this.#t ? this.#t("status.couldNotReach", { detail }) : `Could not reach the AI tab: ${detail}`;
      // Detect content script missing
      if (detail.toLowerCase().includes("receiving end") || detail.toLowerCase().includes("could not establish")) {
        this.#message = this.#t
          ? this.#t("status.contentMissing")
          : "Content script not found — reload the AI tab to connect.";
        this.#showReloadTab();
      } else {
        this.#showCopyPrompt(prompt);
      }
      this.#busy = false;
      this.#render();
      return false;
    } finally {
      this.#busy = false;
      // Ensure final render if not already
      try {
        this.#render();
      } catch {
        // ignore in test teardown
      }
    }
  }

  #showCopyPrompt(prompt) {
    this.#lastPrompt = prompt;
    if (this.#refs.controls.copyPrompt) {
      this.#refs.controls.copyPrompt.hidden = false;
      this.#refs.controls.copyPrompt.textContent = this.#t ? this.#t("status.copyPrompt") : "Copy prompt";
    }
  }

  #hideCopyPrompt() {
    if (this.#refs.controls.copyPrompt) {
      this.#refs.controls.copyPrompt.hidden = true;
    }
  }

  #showReloadTab() {
    if (this.#refs.controls.reloadTab) {
      this.#refs.controls.reloadTab.hidden = false;
      this.#refs.controls.reloadTab.textContent = this.#t ? this.#t("status.reloadTab") : "Reload the tab";
    }
  }

  #hideReloadTab() {
    if (this.#refs.controls.reloadTab) {
      this.#refs.controls.reloadTab.hidden = true;
    }
  }

  #showUndoDelete(text, onUndo) {
    this.#message = text;
    // Use status-action for undo
    if (this.#refs.controls.statusAction) {
      this.#refs.controls.statusAction.hidden = false;
      this.#refs.controls.statusAction.textContent = this.#t ? this.#t("library.undo") : "Undo";
      this.#refs.controls.statusAction.dataset.action = StatusAction.UNDO_DELETE;
      this.#refs.controls.statusAction._undoCallback = onUndo;
    }
    clearTimeout(this.#undoDeleteTimer);
    this.#undoDeleteTimer = window.setTimeout(() => {
      if (this.#refs.controls.statusAction?.dataset.action === StatusAction.UNDO_DELETE) {
        this.#refs.controls.statusAction.hidden = true;
      }
    }, 10000);
  }

  /**
   * Makes sure the bridge script is present in the tab.
   *
   * @param {number} tabId
   * @returns {Promise<void>}
   */
  async #ensureContentScript(tabId) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, createMessage(MessageType.PING));
      if (pong?.diagnostics) {
        this.#diagnostics = pong.diagnostics;
        this.#renderDiagnostics();
      }
      return;
    } catch {
      log.debug("content script missing, injecting");
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    } catch (error) {
      log.warn("could not inject the content script", describeRuntimeError(error));
      throw error;
    }
  }

  /**
   * @param {string} color piece colour of the promoting pawn.
   * @returns {Promise<string>} chosen piece type, or `''` when cancelled.
   */
  async #askPromotionPiece(color) {
    const dialog = this.#refs.promotionDialog;
    if (!dialog?.root) return "";
    const isWhite = colorOf(color) === "w";
    const previouslyFocused = document.activeElement;

    for (const button of dialog.buttons) {
      const piece = button.dataset.piece || "q";
      const glyph = isWhite ? PIECE_GLYPHS[piece.toUpperCase()] : PIECE_GLYPHS[piece];
      button.textContent = glyph;
      button.setAttribute("aria-label", `Promote to ${PIECE_NAMES[piece]}`);
    }
    dialog.root.showModal();
    // Focus queen
    dialog.buttons[0]?.focus();

    try {
      return await new Promise((resolve) => {
        const finish = (value) => {
          dialog.root.removeEventListener("click", onClick);
          dialog.root.removeEventListener("cancel", onCancel);
          dialog.root.removeEventListener("close", onCancel);
          if (dialog.root.open) {
            dialog.root.close();
          }
          // Restore focus
          if (previouslyFocused && previouslyFocused.focus) {
            try {
              previouslyFocused.focus({ preventScroll: true });
            } catch {
              // ignore
            }
          } else {
            this.#refs.board?.focus?.();
          }
          resolve(value);
        };
        const onClick = (event) => {
          const target = event.target;
          if (!(target instanceof Element)) {
            return;
          }
          const button = target.closest("[data-piece]");
          if (button) {
            finish(button.dataset.piece || "");
            return;
          }
          if (target.closest("[data-cancel]")) {
            finish("");
          }
        };
        const onCancel = () => finish("");

        dialog.root.addEventListener("click", onClick);
        dialog.root.addEventListener("cancel", onCancel);
        dialog.root.addEventListener("close", onCancel);
      });
    } finally {
      dialog.root.close();
    }
  }

  /**
   * @param {{supported?: boolean, platform?: string, tabId?: number|null, url?: string}|null} description
   */
  #setConnection(description) {
    const platform = platformForUrl(description?.url || "") || null;
    this.#connection = {
      supported: Boolean(description?.supported ?? platform),
      platform: platform?.id || "",
      label: platform?.name || "",
      tabId: Number.isInteger(description?.tabId) ? /** @type {number} */ (description.tabId) : null,
      url: description?.url || "",
    };
    this.#updateBadge();
  }

  #updateBadge() {
    try {
      const gameState = {
        turn: this.#session.turn,
        check: this.#session.isCheck,
        over: this.#session.isGameOver,
        plyCount: this.#session.plyCount,
      };
      chrome.runtime.sendMessage({ type: "GAME_STATE_CHANGED", gameState }).catch(() => {});
      // Also directly update badge via background API if available
      if (this.#connection.tabId !== null) {
        // background will handle via lastDescription
      }
    } catch {
      // ignore
    }
  }

  #bindEvents() {
    const { controls, pgnDialog, settingsDialog, platformBanner, fenDialog, library, libraryRenameDialog } = this.#refs;

    controls.undo.addEventListener("click", () => this.undo());
    controls.newGame.addEventListener("click", () => this.resetGame());
    controls.flip.addEventListener("click", () => {
      this.#flipOverride = !this.#effectiveFlipped();
      this.#render();
    });
    controls.askAi.addEventListener("click", () => void this.requestAiMove());
    controls.copyPgn.addEventListener("click", () => void this.#copyPgn());
    controls.openPgn.addEventListener("click", () => this.#openPgnDialog());
    controls.copyFen.addEventListener(
      "click",
      () => void this.#copyText(this.#session.fen, this.#t ? this.#t("status.fenCopied") : "FEN copied."),
    );
    controls.statusAction.addEventListener("click", () => void this.#runStatusAction());

    if (controls.copyPrompt) {
      controls.copyPrompt.addEventListener(
        "click",
        () => void this.#copyText(this.#lastPrompt, this.#t ? this.#t("status.promptCopied") : "Prompt copied."),
      );
    }
    if (controls.reloadTab) {
      controls.reloadTab.addEventListener("click", () => void this.#reloadActiveTab());
    }
    if (controls.hint) {
      controls.hint.addEventListener("click", () => void this.requestHint());
    }
    if (controls.analyseGame) {
      controls.analyseGame.addEventListener("click", () => void this.analyseGame());
    }
    if (controls.copyPosition) {
      controls.copyPosition.addEventListener("click", () => void this.#copyPosition());
    }
    if (controls.pasteFen) {
      controls.pasteFen.addEventListener("click", () => this.#openFenDialog());
    }
    if (controls.playVsEngine) {
      controls.playVsEngine.addEventListener("click", () => void this.playVsEngine());
    }
    if (controls.stopEngine) {
      controls.stopEngine.addEventListener("click", () => this.stopEngine());
    }
    if (controls.replayStart) {
      controls.replayStart.addEventListener("click", () => this.jumpToPly(0));
    }
    if (controls.replayBack) {
      controls.replayBack.addEventListener("click", () => this.jumpToPly(this.#session.currentPly - 1));
    }
    if (controls.replayForward) {
      controls.replayForward.addEventListener("click", () => this.jumpToPly(this.#session.currentPly + 1));
    }
    if (controls.replayEnd) {
      controls.replayEnd.addEventListener("click", () => this.jumpToPly(this.#session.history.length));
    }

    // Settings dialog
    settingsDialog.root.addEventListener("close", () => this.#render());
    settingsDialog.controls.side.addEventListener("change", (event) => {
      const value = /** @type {HTMLSelectElement} */ (event.target).value;
      void this.updateSettings({ playerColor: value === "b" ? "b" : "w" });
    });
    settingsDialog.controls.theme.addEventListener("change", (event) => {
      const value = /** @type {HTMLSelectElement} */ (event.target).value;
      void this.updateSettings({ theme: value });
    });
    if (settingsDialog.controls.locale) {
      settingsDialog.controls.locale.addEventListener("change", (event) => {
        const value = /** @type {HTMLSelectElement} */ (event.target).value;
        void this.updateSettings({ locale: value });
      });
    }
    if (settingsDialog.controls.boardTheme) {
      settingsDialog.controls.boardTheme.addEventListener("change", (event) => {
        const value = /** @type {HTMLSelectElement} */ (event.target).value;
        void this.updateSettings({ boardTheme: value });
      });
    }
    if (settingsDialog.controls.fontScale) {
      settingsDialog.controls.fontScale.addEventListener("change", (event) => {
        const value = /** @type {HTMLSelectElement} */ (event.target).value;
        void this.updateSettings({ fontScale: value });
      });
    }
    if (settingsDialog.controls.density) {
      settingsDialog.controls.density.addEventListener("change", (event) => {
        const value = /** @type {HTMLSelectElement} */ (event.target).value;
        void this.updateSettings({ density: value });
      });
    }
    if (settingsDialog.controls.engineLevel) {
      settingsDialog.controls.engineLevel.addEventListener("change", (event) => {
        const value = Number(/** @type {HTMLSelectElement} */ (event.target).value);
        void this.updateSettings({ engineLevel: value });
        this.#engineLevel = value;
      });
    }

    for (const input of settingsDialog.controls.toggles) {
      input.addEventListener("change", () => {
        const key = input.dataset.setting;
        if (!key) {
          return;
        }
        void this.updateSettings({ [key]: input.checked });
      });
    }

    if (settingsDialog.controls.reset) {
      settingsDialog.controls.reset.addEventListener("click", () => void this.updateSettings({ ...DEFAULT_SETTINGS }));
    }

    pgnDialog.load.addEventListener("click", () => this.#loadPgnFromDialog());
    pgnDialog.copy.addEventListener(
      "click",
      () => void this.#copyText(pgnDialog.textarea.value, this.#t ? this.#t("status.pgnCopied") : "PGN copied."),
    );

    if (fenDialog?.apply) {
      fenDialog.apply.addEventListener("click", () => this.#applyFenFromDialog());
    }

    if (platformBanner?.open) {
      platformBanner.open.addEventListener("click", () => void this.#openSelectedPlatform());
    }

    // Library events
    if (library?.search) {
      library.search.addEventListener("input", (event) => {
        this.#librarySearch = /** @type {HTMLInputElement} */ (event.target).value.toLowerCase();
        this.#renderLibrary();
      });
    }
    if (library?.import) {
      library.import.addEventListener("click", () => this.#importPgnFile());
    }
    if (library?.exportAll) {
      library.exportAll.addEventListener("click", () => void this.#exportAllGames());
    }
    if (library?.new) {
      library.new.addEventListener("click", () => this.resetGame());
    }
    if (library?.list) {
      library.list.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const actionBtn = target.closest("[data-action]");
        if (!actionBtn) return;
        const id = actionBtn.getAttribute("data-id");
        const action = actionBtn.getAttribute("data-action");
        if (!id || !action) return;
        switch (action) {
          case "open":
            void this.openLibraryGame(id);
            break;
          case "rename":
            this.#openRenameDialog(id);
            break;
          case "duplicate":
            void this.duplicateLibraryGame(id);
            break;
          case "delete":
            void this.deleteLibraryGame(id);
            break;
          case "export":
            void this.exportLibraryGame(id);
            break;
        }
      });
    }

    if (libraryRenameDialog?.save) {
      libraryRenameDialog.save.addEventListener("click", () => this.#saveRename());
    }

    // Diagnostics
    if (this.#refs.diagnostics?.copy) {
      this.#refs.diagnostics.copy.addEventListener("click", () => void this.#copyDiagnostics());
    }
    if (this.#refs.diagnostics?.toggle) {
      this.#refs.diagnostics.toggle.addEventListener("click", () => this.#toggleDiagnostics());
    }

    // Keyboard shortcuts — guarded for Node test harness without DOM
    try {
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("keydown", (event) => this.#handleShortcuts(event));
      }
    } catch {
      // ignore in test
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === MessageType.AI_MOVE) {
        void this.handleAiMove(message);
        return;
      }
      if (message?.type === MessageType.CONTENT_STATUS) {
        if (message.diagnostics) {
          this.#diagnostics = message.diagnostics;
          this.#renderDiagnostics();
        }
        if (message.state === "no-move") {
          void this.handleAiMove({ noMove: true, text: message.text });
          return;
        }
        if (typeof message.error === "string" && message.error) {
          this.#message = message.error;
          this.#phase = Phase.ERROR;
          this.#render();
          return;
        }
      }
      if (message?.type === MessageType.ACTIVE_TAB_CHANGED) {
        this.#setConnection(message);
        this.#render();
      }
    });
  }

  #handleShortcuts(event) {
    // Ignore if in input/textarea/contenteditable
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key.toLowerCase()) {
      case "n":
        event.preventDefault();
        this.resetGame();
        break;
      case "u":
        event.preventDefault();
        this.undo();
        break;
      case "f":
        event.preventDefault();
        this.#flipOverride = !this.#effectiveFlipped();
        this.#render();
        break;
      case "c":
        event.preventDefault();
        void this.#copyPgn();
        break;
      case "b":
        event.preventDefault();
        this.#refs.board?.focus();
        break;
      case "h":
        event.preventDefault();
        void this.requestHint();
        break;
      case "?":
        event.preventDefault();
        this.#refs.shortcutsDialog?.root?.showModal();
        break;
    }
  }

  #renderPlatformOptions() {
    const { select } = this.#refs.platformBanner;
    if (!select) return;
    const fragment = document.createDocumentFragment();
    for (const platform of PLATFORMS) {
      const option = document.createElement("option");
      option.value = `https://${platform.hosts[0]}/`;
      option.textContent = platform.name;
      fragment.append(option);
    }
    select.replaceChildren(fragment);
  }

  async #openSelectedPlatform() {
    const url = this.#refs.platformBanner.select.value;
    if (url) {
      await chrome.tabs.create({ url });
    }
  }

  #openPgnDialog() {
    const { pgnDialog } = this.#refs;
    pgnDialog.textarea.value = this.#session.toPgn();
    pgnDialog.status.textContent = "";
    pgnDialog.root.showModal();
    pgnDialog.textarea.focus();
  }

  #openFenDialog() {
    const { fenDialog } = this.#refs;
    if (!fenDialog?.root) return;
    if (fenDialog.input) {
      fenDialog.input.value = this.#session.fen;
    }
    if (fenDialog.status) {
      fenDialog.status.textContent = "";
    }
    fenDialog.root.showModal();
    fenDialog.input?.focus();
  }

  #applyFenFromDialog() {
    const { fenDialog } = this.#refs;
    if (!fenDialog?.input) return;
    const fen = fenDialog.input.value.trim();
    const result = this.#session.setFen(fen);
    if (!result.ok) {
      if (fenDialog.status) {
        fenDialog.status.textContent = result.error;
      }
      return;
    }
    this.#phase = Phase.IDLE;
    this.#clearSelection();
    this.#message = "Position set from FEN.";
    this.#persist();
    this.#render();
    this.#updateBadge();
    fenDialog.root.close();
  }

  #loadPgnFromDialog() {
    const { pgnDialog } = this.#refs;
    const result = this.loadPgn(pgnDialog.textarea.value);

    if (!result.ok) {
      pgnDialog.status.textContent = result.error;
      return;
    }

    if (result.error) {
      pgnDialog.status.textContent = `Loaded the valid part of the game. ${result.error}`;
      return;
    }
    pgnDialog.root.close();
  }

  async #copyPgn() {
    await this.#copyText(this.#session.toPgn(), this.#t ? this.#t("status.pgnCopied") : "PGN copied to the clipboard.");
  }

  async #copyPosition() {
    const text = `FEN: ${this.#session.fen}\nPGN: ${this.#session.toPgn()}`;
    await this.#copyText(text, "Position copied.");
  }

  /**
   * @param {string} text
   * @param {string} confirmation
   * @returns {Promise<void>}
   */
  async #copyText(text, confirmation) {
    try {
      await navigator.clipboard.writeText(text);
      this.#message = confirmation;
      this.#phase = Phase.IDLE;
      this.#hideCopyPrompt();
      this.#hideReloadTab();
    } catch (error) {
      log.warn("clipboard unavailable", error);
      this.#message = this.#t
        ? this.#t("status.copyFailed")
        : "Copying failed — your browser blocked clipboard access.";
      this.#phase = Phase.ERROR;
    }
    this.#render();
  }

  async #copyDiagnostics() {
    if (!this.#diagnostics) return;
    const report = formatReport(this.#diagnostics);
    await this.#copyText(report, this.#t ? this.#t("diagnostics.reportCopied") : "Diagnostics copied.");
  }

  #toggleDiagnostics() {
    const reportEl = this.#refs.diagnostics?.report;
    const toggleBtn = this.#refs.diagnostics?.toggle;
    if (!reportEl || !toggleBtn) return;
    const hidden = reportEl.hidden;
    reportEl.hidden = !hidden;
    if (!hidden) {
      reportEl.textContent = "";
      toggleBtn.textContent = "Show details";
    } else {
      reportEl.textContent = this.#diagnostics ? formatReport(this.#diagnostics) : "No diagnostics yet.";
      toggleBtn.textContent = "Hide details";
    }
  }

  #renderDiagnostics() {
    const diag = this.#refs.diagnostics;
    if (!diag) return;
    if (!this.#diagnostics) {
      if (diag.platform) diag.platform.textContent = "—";
      if (diag.composer) diag.composer.textContent = "—";
      if (diag.send) diag.send.textContent = "—";
      if (diag.assistant) diag.assistant.textContent = "—";
      if (diag.timings) diag.timings.textContent = "—";
      if (diag.error) diag.error.textContent = "—";
      return;
    }
    if (diag.platform) diag.platform.textContent = this.#diagnostics.platform || "—";
    if (diag.composer) diag.composer.textContent = this.#diagnostics.matchedComposer || "Not found";
    if (diag.send) diag.send.textContent = this.#diagnostics.matchedSend || "—";
    if (diag.assistant) diag.assistant.textContent = this.#diagnostics.matchedAssistant || "—";
    if (diag.timings) {
      const t = this.#diagnostics.timings;
      diag.timings.textContent = `find:${t.findInput}ms type:${t.type}ms submit:${t.submit}ms total:${t.total}ms`;
    }
    if (diag.error) diag.error.textContent = this.#diagnostics.lastError || "—";
    if (diag.report && !diag.report.hidden) {
      diag.report.textContent = formatReport(this.#diagnostics);
    }
  }

  async #runStatusAction() {
    const status = this.#status();
    switch (status.action) {
      case StatusAction.ASK_AI:
      case StatusAction.RETRY:
        await this.requestAiMove();
        break;
      case StatusAction.OPEN_AI:
        if (this.#refs.platformBanner.root) {
          this.#refs.platformBanner.root.open = true;
        }
        break;
      case StatusAction.NEW_GAME:
        this.resetGame();
        break;
      case StatusAction.RELOAD_TAB:
        await this.#reloadActiveTab();
        break;
      case StatusAction.COPY_PROMPT:
        await this.#copyText(this.#lastPrompt, this.#t ? this.#t("status.promptCopied") : "Prompt copied.");
        break;
      case StatusAction.UNDO_DELETE:
        if (this.#refs.controls.statusAction?._undoCallback) {
          this.#refs.controls.statusAction._undoCallback();
        }
        break;
      default:
        break;
    }
  }

  async #reloadActiveTab() {
    if (!this.#connection.tabId) return;
    try {
      await chrome.tabs.reload(this.#connection.tabId);
      this.#message = "Tab reloaded — waiting for connection…";
      this.#hideReloadTab();
      this.#render();
    } catch (error) {
      this.#message = `Could not reload tab: ${describeRuntimeError(error)}`;
      this.#phase = Phase.ERROR;
      this.#render();
    }
  }

  #clearSelection() {
    this.#selected = -1;
    this.#targets = [];
  }

  /** @returns {boolean} whether the board is drawn from Black's side. */
  #effectiveFlipped() {
    return this.#flipOverride ?? this.#session.playerColor === "b";
  }

  /** @returns {ReturnType<typeof describeStatus>} */
  #status() {
    return describeStatus({
      session: this.#session,
      connection: this.#connection,
      phase: this.#phase,
      message: this.#message,
      busy: this.#phase === Phase.SENDING || this.#busy,
      t: this.#t,
      diagnosticsError: this.#diagnostics?.lastError || "",
    });
  }

  /** Schedules a debounced snapshot write. */
  #persist() {
    window.clearTimeout(this.#persistTimer);
    this.#persistTimer = window.setTimeout(async () => {
      if (!this.#settings.persistGame) {
        return;
      }
      try {
        const ok = await writeValue(GAME_KEY, this.#session.snapshot());
        if (!ok) {
          this.#message = this.#t ? this.#t("status.storageFull") : "Storage is full — delete old games to free space.";
          this.#phase = Phase.ERROR;
          this.#render();
        }
        // Also save to library if game has moves
        if (this.#library && this.#session.plyCount > 0) {
          const game = gameFromSnapshot(this.#session.snapshot(), { title: `Game ${new Date().toLocaleDateString()}` });
          this.#library = addGame(this.#library, game);
          await writeLibrary(this.#library);
          this.#renderLibrary();
        }
      } catch (error) {
        log.warn("persist failed", error);
      }
    }, 150);
  }

  #render() {
    const status = this.#status();
    const session = this.#session;
    const last = session.lastMove;

    this.#boardView.render(
      describeBoard({
        position: session.position,
        selected: this.#selected,
        targets: this.#targets,
        lastMove: last ? squaresOfUci(last.uci) : null,
        flipped: this.#effectiveFlipped(),
        showCoordinates: this.#settings.showCoordinates,
        showLegalTargets: this.#settings.showLegalTargets,
      }),
      {
        selected: this.#selected,
        interactive: !this.#busy && session.isPlayerTurn && !session.isGameOver,
        hint: this.#hintMove,
      },
    );

    this.#historyView.render(session.history, {
      startMoveNumber: this.#historyStartNumber(),
      firstMover: this.#historyFirstMover(),
      currentPly: session.currentPly,
    });

    const { status: statusNode, statusAction, turn, opponent, fen, controls } = this.#refs;
    if (statusNode) {
      statusNode.textContent = status.text;
      statusNode.dataset.kind = status.kind;
    }
    if (statusAction) {
      statusAction.hidden = status.action === StatusAction.NONE;
      statusAction.textContent = ACTION_LABELS[status.action] || status.action || "";
      statusAction.dataset.action = status.action;
    }

    if (turn) {
      turn.textContent = session.isGameOver
        ? this.#t
          ? this.#t("status.gameOver")
          : "Game over"
        : session.turn === "w"
          ? "White to move"
          : "Black to move";
    }
    if (opponent) {
      opponent.textContent = this.#connection.supported
        ? `${this.#connection.label} (${session.aiColor === "w" ? "White" : "Black"})`
        : this.#t
          ? this.#t("status.noAi")
          : "No AI chat open";
    }
    if (fen) {
      fen.textContent = session.fen;
    }

    if (controls.undo) controls.undo.disabled = session.plyCount === 0 || this.#busy;
    if (controls.newGame) controls.newGame.disabled = this.#busy;
    if (controls.flip) controls.flip.disabled = this.#busy;
    if (controls.askAi) {
      controls.askAi.hidden = !(session.isWaitingForAi && !session.isGameOver);
      controls.askAi.disabled = this.#phase === Phase.SENDING || this.#busy;
    }
    if (controls.hint) {
      controls.hint.disabled = this.#busy || session.isGameOver;
    }

    // Replay controls
    if (controls.replayStart) controls.replayStart.disabled = !session.canGoBack;
    if (controls.replayBack) controls.replayBack.disabled = !session.canGoBack;
    if (controls.replayForward) controls.replayForward.disabled = !session.canGoForward;
    if (controls.replayEnd) controls.replayEnd.disabled = !session.canGoForward;

    this.#renderEval();
    this.#renderClock();
    this.#renderDiagnostics();

    // FEN status
    if (this.#refs.fenStatus) {
      this.#refs.fenStatus.textContent = "";
    }
  }

  #renderEval() {
    const evalBar = this.#refs.evalBar;
    const evalFill = this.#refs.evalFill;
    const evalText = this.#refs.evalText;
    if (!evalBar || !evalFill || !evalText) return;

    if (!this.#settings.evalBarEnabled) {
      evalBar.hidden = true;
      evalText.hidden = true;
      return;
    }

    evalBar.hidden = false;
    evalText.hidden = false;

    let score = this.#evalScore;
    if (score === null || score === undefined) {
      try {
        score = evaluate(this.#session.position);
      } catch {
        score = 0;
      }
    }

    const formatted = formatEval(score);
    evalText.textContent = `Eval: ${formatted.text} (heuristic)`;

    // Convert score to 0-100% for white
    const clamped = Math.max(-1000, Math.min(1000, score));
    const percent = 50 + (clamped / 2000) * 50;
    evalFill.style.width = `${percent}%`;
  }

  /** @returns {number} first move number, taken from the starting FEN. */
  #historyStartNumber() {
    return Number.parseInt(this.#session.initialFen.split(/\\s+/)[5] || "1", 10) || 1;
  }

  /** @returns {'w'|'b'} colour of the first ply in the history. */
  #historyFirstMover() {
    return this.#session.initialFen.split(/\\s+/)[1] === "b" ? "b" : "w";
  }

  #applySettingsToDialog() {
    const { settingsDialog } = this.#refs;
    if (!settingsDialog?.controls) return;
    if (settingsDialog.controls.side) settingsDialog.controls.side.value = this.#settings.playerColor;
    if (settingsDialog.controls.theme) settingsDialog.controls.theme.value = this.#settings.theme;
    if (settingsDialog.controls.locale) settingsDialog.controls.locale.value = this.#settings.locale;
    if (settingsDialog.controls.boardTheme) settingsDialog.controls.boardTheme.value = this.#settings.boardTheme;
    if (settingsDialog.controls.fontScale) settingsDialog.controls.fontScale.value = this.#settings.fontScale;
    if (settingsDialog.controls.density) settingsDialog.controls.density.value = this.#settings.density;
    if (settingsDialog.controls.engineLevel) settingsDialog.controls.engineLevel.value = String(this.#engineLevel);

    document.body.dataset.theme = resolveTheme(this.#settings.theme);
    document.body.dataset.boardTheme = this.#settings.boardTheme;
    document.body.dataset.fontScale = this.#settings.fontScale;
    document.body.dataset.density = this.#settings.density;

    for (const input of settingsDialog.controls.toggles) {
      const key = input.dataset.setting;
      if (key && key in this.#settings) {
        input.checked = Boolean(this.#settings[/** @type {keyof typeof this.#settings} */ (key)]);
      }
    }
  }

  // --- Library ---

  #renderLibrary() {
    const lib = this.#refs.library;
    if (!lib?.list) return;
    if (!this.#library) {
      lib.list.replaceChildren();
      if (lib.empty) lib.empty.hidden = false;
      return;
    }

    let games = this.#library.games;
    if (this.#librarySearch) {
      games = games.filter(
        (g) => g.title.toLowerCase().includes(this.#librarySearch) || g.date.includes(this.#librarySearch),
      );
    }

    if (lib.empty) {
      lib.empty.hidden = games.length > 0;
    }

    if (games.length === 0) {
      lib.list.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const game of games) {
      const item = document.createElement("div");
      item.className = "library-item";

      const title = document.createElement("div");
      title.className = "library-item-title";
      title.textContent = game.title;
      item.append(title);

      const meta = document.createElement("div");
      meta.className = "library-item-meta";
      meta.textContent = `${game.date} • ${game.result} • ${game.moves.length} moves • ${game.playerColor === "w" ? "White" : "Black"}`;
      item.append(meta);

      const actions = document.createElement("div");
      actions.className = "library-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "button";
      openBtn.textContent = "Open";
      openBtn.dataset.action = "open";
      openBtn.dataset.id = game.id;
      actions.append(openBtn);

      const renameBtn = document.createElement("button");
      renameBtn.className = "button";
      renameBtn.textContent = "Rename";
      renameBtn.dataset.action = "rename";
      renameBtn.dataset.id = game.id;
      actions.append(renameBtn);

      const dupBtn = document.createElement("button");
      dupBtn.className = "button";
      dupBtn.textContent = "Dup";
      dupBtn.dataset.action = "duplicate";
      dupBtn.dataset.id = game.id;
      actions.append(dupBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "button";
      delBtn.textContent = "Delete";
      delBtn.dataset.action = "delete";
      delBtn.dataset.id = game.id;
      actions.append(delBtn);

      const expBtn = document.createElement("button");
      expBtn.className = "button";
      expBtn.textContent = "Export";
      expBtn.dataset.action = "export";
      expBtn.dataset.id = game.id;
      actions.append(expBtn);

      item.append(actions);
      fragment.append(item);
    }

    lib.list.replaceChildren(fragment);
  }

  async openLibraryGame(id) {
    if (!this.#library) return;
    const game = this.#library.games.find((g) => g.id === id);
    if (!game) return;

    try {
      const session = GameSession.fromSnapshot(
        {
          version: 2,
          initialFen: game.initialFen,
          playerColor: game.playerColor,
          moves: game.moves,
          result: game.result,
        },
        { playerColor: game.playerColor },
      );
      this.#session = session;
      this.#message = `Opened ${game.title}`;
      this.#persist();
      this.#render();
      this.#updateBadge();
    } catch (error) {
      this.#message = `Could not open game: ${error.message}`;
      this.#phase = Phase.ERROR;
      this.#render();
    }
  }

  async duplicateLibraryGame(id) {
    if (!this.#library) return;
    this.#library = duplicateGame(this.#library, id);
    await writeLibrary(this.#library);
    this.#renderLibrary();
    this.#message = "Game duplicated.";
    this.#render();
  }

  async deleteLibraryGame(id) {
    if (!this.#library) return;
    const { library, deleted } = deleteGame(this.#library, id);
    this.#library = library;
    this.#lastDeletedGame = deleted;
    await writeLibrary(this.#library);
    await writeValue(LAST_DELETED_KEY, deleted);
    this.#renderLibrary();
    this.#showUndoDelete(
      this.#t ? this.#t("library.undoDelete") : "Game deleted — Undo",
      () => void this.undoLibraryDelete(),
    );
  }

  async undoLibraryDelete() {
    if (!this.#lastDeletedGame) {
      const stored = await readValue(LAST_DELETED_KEY, null);
      if (!stored) return;
      this.#lastDeletedGame = stored;
    }
    if (!this.#library || !this.#lastDeletedGame) return;
    this.#library = addGame(this.#library, this.#lastDeletedGame);
    await writeLibrary(this.#library);
    this.#lastDeletedGame = null;
    await removeValue(LAST_DELETED_KEY);
    this.#renderLibrary();
    this.#message = "Game restored.";
    this.#render();
  }

  async exportLibraryGame(id) {
    if (!this.#library) return;
    const game = this.#library.games.find((g) => g.id === id);
    if (!game) return;
    try {
      const session = GameSession.fromSnapshot(
        {
          version: 2,
          initialFen: game.initialFen,
          playerColor: game.playerColor,
          moves: game.moves,
          result: game.result,
        },
        { playerColor: game.playerColor },
      );
      const pgn = session.toPgn();
      await this.#copyText(pgn, "PGN copied.");
      // Also download
      this.#downloadText(pgn, `${game.title.replace(/[^a-z0-9]/gi, "_")}.pgn`);
    } catch (error) {
      this.#message = `Export failed: ${error.message}`;
      this.#phase = Phase.ERROR;
      this.#render();
    }
  }

  #downloadText(text, filename) {
    try {
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // ignore
    }
  }

  async #exportAllGames() {
    if (!this.#library) return;
    const allPgn = this.#library.games
      .map((game) => {
        try {
          const session = GameSession.fromSnapshot(
            {
              version: 2,
              initialFen: game.initialFen,
              playerColor: game.playerColor,
              moves: game.moves,
              result: game.result,
            },
            { playerColor: game.playerColor },
          );
          return session.toPgn();
        } catch {
          return "";
        }
      })
      .join("\n\n");
    this.#downloadText(allPgn, "ai-chess-games.pgn");
    await this.#copyText(allPgn, "All games exported.");
  }

  #importPgnFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pgn,.txt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const result = this.loadPgn(text);
      if (!result.ok) {
        this.#message = result.error;
        this.#phase = Phase.ERROR;
        this.#render();
      } else {
        // Save to library
        if (this.#library) {
          const game = gameFromSnapshot(this.#session.snapshot(), { title: file.name.replace(/\.pgn$/i, "") });
          this.#library = addGame(this.#library, game);
          await writeLibrary(this.#library);
          this.#renderLibrary();
        }
      }
    };
    input.click();
  }

  #openRenameDialog(id) {
    this.#renameTargetId = id;
    const game = this.#library?.games.find((g) => g.id === id);
    if (!game) return;
    const dialog = this.#refs.libraryRenameDialog;
    if (!dialog?.root) return;
    if (dialog.input) {
      dialog.input.value = game.title;
    }
    dialog.root.showModal();
    dialog.input?.focus();
  }

  #saveRename() {
    if (!this.#renameTargetId || !this.#library) return;
    const dialog = this.#refs.libraryRenameDialog;
    const newTitle = dialog?.input?.value?.trim();
    if (!newTitle) return;
    this.#library = updateGame(this.#library, this.#renameTargetId, { title: newTitle });
    void writeLibrary(this.#library);
    this.#renderLibrary();
    dialog?.root?.close();
    this.#renameTargetId = null;
  }

  // --- Replay ---

  jumpToPly(ply) {
    let target = ply;
    if (target < 0) target = 0;
    if (target > this.#session.history.length) target = this.#session.history.length;
    const ok = this.#session.jumpToPly(target);
    if (ok) {
      this.#render();
      this.#announce(`Ply ${target}`);
    }
  }

  // --- Analysis ---

  async requestHint() {
    if (this.#busy) return;
    if (this.#session.isGameOver) return;

    this.#hintMove = null;
    this.#busy = true;
    this.#message = this.#t ? this.#t("analysis.evaluating") : "Evaluating…";
    this.#render();

    try {
      if (this.#engineWorker) {
        const fen = this.#session.fen;
        const id = `hint-${Date.now()}`;
        this.#engineWorker.postMessage({ type: "search", fen, maxDepth: this.#engineLevel, timeLimitMs: 1500, id });
        // Result handled via onmessage
        setTimeout(() => {
          if (this.#busy) {
            this.#busy = false;
            this.#message = "";
            this.#render();
          }
        }, 2000);
      } else {
        // Fallback: use synchronous search (may block, but okay for test)
        const { findBestMove } = await import("../core/search.js");
        const result = findBestMove(this.#session.position, {
          level: this.#engineLevel,
          maxDepth: this.#engineLevel,
          timeLimitMs: 1000,
        });
        if (result.move) {
          this.#hintMove = { from: result.move.from, to: result.move.to };
          this.#evalScore = result.score;
        }
        this.#busy = false;
        this.#render();
      }
    } catch (error) {
      log.warn("hint failed", error);
      this.#busy = false;
      this.#message = "Hint failed.";
      this.#render();
    }
  }

  async analyseGame() {
    if (this.#busy) return;
    const report = this.#session.analyseGame();
    const analysisEl = this.#refs.analysis?.report;
    if (!analysisEl) return;

    const fragment = document.createDocumentFragment();

    const accTitle = document.createElement("div");
    accTitle.textContent = `Accuracy — White: ${report.accuracy.white}% Black: ${report.accuracy.black}% (heuristic)`;
    fragment.append(accTitle);

    const whiteBar = document.createElement("div");
    whiteBar.className = "accuracy-bar";
    const whiteFill = document.createElement("div");
    whiteFill.className = "accuracy-fill";
    whiteFill.style.width = `${report.accuracy.white}%`;
    whiteBar.append(whiteFill);
    fragment.append(whiteBar);

    if (report.swings.length > 0) {
      const swingsTitle = document.createElement("div");
      swingsTitle.textContent = "Biggest swings:";
      swingsTitle.style.marginTop = "8px";
      swingsTitle.style.fontWeight = "600";
      fragment.append(swingsTitle);

      for (const swing of report.swings) {
        const div = document.createElement("div");
        div.textContent = `${swing.ply}. ${swing.san} — ${swing.classification} (${swing.swing > 0 ? "+" : ""}${swing.swing})`;
        div.className = `history-move is-${swing.classification}`;
        fragment.append(div);
      }
    }

    analysisEl.replaceChildren(fragment);
    this.#announce(`Analysis complete, White ${report.accuracy.white}%, Black ${report.accuracy.black}%`);
  }

  async playVsEngine() {
    if (this.#busy) return;
    // If it's player turn, let engine play as AI
    if (this.#session.isPlayerTurn) {
      this.#message = "Engine will play as opponent after your move.";
      this.#render();
      return;
    }
    // Engine's turn now
    await this.requestHint();
    // After hint, auto-play best move after short delay
    setTimeout(() => {
      if (this.#hintMove) {
        const uci = `${toName(this.#hintMove.from)}${toName(this.#hintMove.to)}`;
        const result = this.#session.playAiMove(uci);
        if (result.ok) {
          this.#persist();
          this.#render();
          this.#updateBadge();
          this.#playSoundForMove(result.entry);
          this.#announceMove(result.entry);
        }
        this.#hintMove = null;
      }
    }, 600);
  }

  stopEngine() {
    if (this.#engineWorker) {
      this.#engineWorker.postMessage({ type: "stop" });
    }
    this.#busy = false;
    this.#setEngineBusy(false);
    this.#message = "";
    this.#render();
  }
}

/** Labels for the status action button. */
const ACTION_LABELS = Object.freeze({
  [StatusAction.ASK_AI]: "Ask the AI to move",
  [StatusAction.RETRY]: "Ask again",
  [StatusAction.OPEN_AI]: "Open an AI chat",
  [StatusAction.NEW_GAME]: "New game",
  [StatusAction.RELOAD_TAB]: "Reload the tab",
  [StatusAction.COPY_PROMPT]: "Copy prompt",
  [StatusAction.UNDO_DELETE]: "Undo",
});

/**
 * @param {{move?: string, candidates?: string[]}|undefined} payload
 * @returns {string[]} candidate UCI moves, newest first.
 */
function normaliseCandidates(payload) {
  const list =
    Array.isArray(payload?.candidates) && payload.candidates.length > 0 ? payload.candidates : [payload?.move];
  const seen = new Set();
  const moves = [];
  for (const candidate of list) {
    const uci = typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
    if (uci && !seen.has(uci)) {
      seen.add(uci);
      moves.push(uci);
    }
  }
  return moves;
}

export { normaliseCandidates };
