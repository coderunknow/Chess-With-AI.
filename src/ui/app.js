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
import { toUci } from "../core/move.js";
import { IllegalReason, explainIllegalMove } from "../core/illegal-move.js";
import { formatPgn } from "../core/pgn.js";
import { createLogger } from "../shared/log.js";
import { MessageType, createMessage, describeRuntimeError, normaliseResponse } from "../shared/messaging.js";
import {
  BATTLE_LEDGER_KEY,
  BATTLE_SNAPSHOT_KEY,
  adjudicateIfNeeded,
  battlePairKey,
  battleRemainingMs,
  completeMove,
  createBattle,
  flagResult,
  gameEndResult,
  pairedPgns,
  pauseBattleClock,
  recordBattleResult,
  resignationResult,
  restoreBattle,
  resumeBattleClock,
  serializeBattle,
  tickBattle,
} from "../shared/battle.js";
import { PLATFORMS, platformForUrl } from "../shared/platforms.js";
import { buildRetryPrompt, buildTurnPrompt, formatMoveList } from "../shared/prompt.js";
import { buildStudioPreview } from "./studio.js";
import { LatencyTimeline, formatLatencyReport } from "../shared/latency.js";
import { DEFAULT_SETTINGS, SETTINGS_KEY, mergeSettings, resolveTheme, resolveLocale } from "../shared/settings.js";
import { readValue, removeValue, writeValue } from "../shared/storage.js";
import { createTranslator } from "../shared/i18n.js";
import { formatReport } from "../shared/diagnostics.js";
import { playSound } from "../shared/sounds.js";
import { createClock, startClock, stopClock, tickClock, formatClock } from "../shared/clock.js";
import { StockfishEngine, clampMoveTime, clampUciElo } from "./stockfish.js";
import { appendRatedMatch, emptyMatches, estimateRating, exportMatches, readMatches } from "../shared/matches.js";
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
import { DeliveryState, StatusAction, describeDelivery, describeStatus } from "./status.js";
import { evaluate, formatEval } from "../core/eval.js";

const log = createLogger("panel");

/** Storage key for the running game. */
export const GAME_KEY = "game";

/** Phase of the prompt state machine. */
export const Phase = Object.freeze({
  IDLE: "idle",
  SENDING: "sending",
  AWAITING: "awaiting",
  /** One submit attempt fired; delivery could not be confirmed. Not a proven failure. */
  UNCONFIRMED: "unconfirmed",
  ERROR: "error",
});

const CONTENT_SCRIPT_FILE = "src/content/index.js";

/**
 * Runs non-critical work (badge, sound, announcements) off the accept path.
 * Bare `setTimeout` keeps Node mock timers in charge; browsers may coalesce
 * via `requestIdleCallback`.
 *
 * @param {() => void} fn
 */
function scheduleOffPath(fn) {
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(fn);
  } else {
    setTimeout(fn, 0);
  }
}

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
  #retryPending = false;
  #retryEpoch = 0;
  #retryToken = 0;
  #lastIllegalReply = null;
  #pin = null;
  #availableTabs = [];
  #refreshEpoch = 0;
  #pinMutationEpoch = 0;
  #expectedReplyId = null;
  #requestCounter = 0;
  #sendInFlight = null;
  #cancelPending = Promise.resolve();
  #stockfish = null;
  #stockfishFactory;
  #stockfishBoot = null;
  #engineEpoch = 0;
  #engineRange = null;
  #engineError = "";
  #matchBook = emptyMatches();
  #match = null;
  #matchSaving = false;
  #localEngineMode = false;
  #matchFinished = false;
  #delivery = null;
  #waitingReminderTimer = 0;
  /** Privacy-safe per-move latency timeline (stage deltas only, ring of 20). */
  #latency = new LatencyTimeline();
  /** @type {Map<string, HTMLElement|null>} cache for static element ids. */
  #byIdCache = new Map();

  /**
   * @param {object} refs DOM references resolved by `main.js`.
   */
  constructor(refs, { stockfishFactory = () => new StockfishEngine() } = {}) {
    this.#refs = refs;
    this.#stockfishFactory = stockfishFactory;
    this.#session = new GameSession();
    this.#boardView = new BoardView(refs.board, {
      onSelect: (square) => void this.selectSquare(square),
      onDrop: (from, to) => void this.handleDrop(from, to),
      interaction: DEFAULT_SETTINGS.moveInteraction,
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

  /** Release panel-local resources (tests/unload), without changing pause or unregistering scripts. */
  dispose() {
    clearTimeout(this.#persistTimer);
    clearTimeout(this.#undoDeleteTimer);
    clearTimeout(this.#announceTimer);
    clearTimeout(this.#waitingReminderTimer);
    clearInterval(this.#clockTimer);
    if (this.#battleTimer) clearInterval(this.#battleTimer);
    this.#stopStockfish();
    this.#engineWorker?.terminate();
  }

  /** @returns {GameSession} the active session (read-only use). */
  get session() {
    return this.#session;
  }

  /** @returns {Readonly<Record<string, any>>} the effective settings (read-only). */
  get settings() {
    return { ...this.#settings };
  }

  /** @returns {string} the last status message (read-only). */
  get message() {
    return this.#message;
  }

  /** @returns {LatencyTimeline} the privacy-safe latency timeline (stage deltas only). */
  get latency() {
    return this.#latency;
  }

  /**
   * The shared prompt context: one builder input for the send path AND the
   * Prompt Studio, so both always produce byte-identical strings.
   *
   * @param {object} [extra] overrides (studio toggles, battle clock).
   * @returns {object} a {@link buildTurnPrompt} context.
   */
  #turnPromptContext(extra = {}) {
    const session = this.#session;
    const last = session.lastMove;
    return {
      fen: session.fen,
      uci: last?.uci || "",
      san: last?.san || "",
      aiColor: session.aiColor,
      history: session.moveListText,
      plyCount: session.plyCount,
      style: this.#settings.promptStyle,
      funSentences: this.#settings.funCommentarySentences,
      battleClock: null, // set by the battle loop while a battle runs
      ...extra,
    };
  }

  /**
   * Prompt Studio preview: the exact string the send path would dispatch for
   * the current position. Overrides only change the preview, never settings.
   *
   * @param {object} [overrides]
   * @param {string} [overrides.style]
   * @param {number} [overrides.funSentences]
   * @param {object|null} [overrides.battleClock] battle-preview clock cue.
   * @returns {import('./studio.js').StudioPreview}
   */
  studioPreview(overrides = {}) {
    const { style, funSentences, battleClock = null, ...rest } = overrides || {};
    const context = this.#turnPromptContext({
      ...(style ? { style } : {}),
      ...(funSentences ? { funSentences } : {}),
      battleClock,
      ...rest,
    });
    return buildStudioPreview({ context, platformLabel: this.#connection.label });
  }

  /**
   * Cached `getElementById`: hot renders must not re-query the document for
   * the same static ids on every state change.
   *
   * @param {string} id
   * @returns {HTMLElement|null}
   */
  #el(id) {
    if (!this.#byIdCache.has(id)) {
      this.#byIdCache.set(id, typeof document !== "undefined" ? document.getElementById(id) : null);
    }
    return this.#byIdCache.get(id);
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

  #stopStockfish() {
    this.#engineEpoch += 1;
    this.#stockfish?.stop();
    this.#stockfish = null;
    this.#stockfishBoot = null;
    this.#engineRange = null;
  }

  async #bootStockfish() {
    if (this.#settings.paused || (this.#stockfish?.ready && this.#engineRange)) return;
    if (this.#stockfishBoot) return this.#stockfishBoot;
    const epoch = this.#engineEpoch;
    const engine = this.#stockfish || this.#stockfishFactory();
    this.#stockfish = engine;
    this.#engineError = "";
    this.#renderMatch();
    const boot = (async () => {
      try {
        const range = await engine.boot();
        if (epoch !== this.#engineEpoch || this.#settings.paused || this.#stockfish !== engine) return;
        const anchor = clampUciElo(this.#settings.matchAnchorElo, range);
        if (anchor !== this.#settings.matchAnchorElo) await this.updateSettings({ matchAnchorElo: anchor });
        if (epoch !== this.#engineEpoch || this.#settings.paused || this.#stockfish !== engine) return;
        this.#engineRange = range;
        this.#renderMatch();
      } catch (error) {
        if (epoch !== this.#engineEpoch || this.#stockfish !== engine) return;
        this.#engineRange = null;
        this.#engineError = error?.message || String(error);
        this.#renderMatch();
      }
    })();
    this.#stockfishBoot = boot;
    try {
      await boot;
    } finally {
      if (this.#stockfishBoot === boot) this.#stockfishBoot = null;
    }
  }

  #renderMatch() {
    const refs = this.#refs.match;
    this.#renderPlayMeta(); // rated banner follows match lifecycle
    if (!refs) return;
    const t = this.#t || createTranslator("en");
    if (refs.engineStatus) {
      refs.engineStatus.textContent = this.#settings.paused
        ? t("match.paused")
        : this.#matchSaving
          ? t("match.saving")
          : this.#engineError
            ? t("match.engineError", { detail: this.#engineError })
            : this.#engineRange
              ? t("match.engineReady", { min: this.#engineRange.min, max: this.#engineRange.max })
              : t("match.loading");
    }
    if (refs.anchor) {
      refs.anchor.disabled = !this.#engineRange || Boolean(this.#match) || this.#matchSaving || this.#settings.paused;
      // Do not display a numeric Elo control until this worker has actually
      // reported its own range. Previous ranges are cleared on engine failure.
      refs.anchor.min = this.#engineRange ? String(this.#engineRange.min) : "";
      refs.anchor.max = this.#engineRange ? String(this.#engineRange.max) : "";
      refs.anchor.value = this.#engineRange ? String(this.#settings.matchAnchorElo) : "";
    }
    if (refs.movetime) {
      refs.movetime.disabled = !this.#engineRange || Boolean(this.#match) || this.#matchSaving || this.#settings.paused;
      refs.movetime.value = String(this.#settings.matchMoveTimeMs);
    }
    if (refs.start)
      refs.start.disabled =
        !this.#engineRange || Boolean(this.#match) || this.#matchSaving || this.#settings.paused || this.#busy;
    if (refs.stop) refs.stop.hidden = !this.#match || this.#matchSaving;
    if (refs.export) refs.export.disabled = this.#matchSaving || this.#matchBook.games.length === 0;
    if (refs.estimate) {
      const estimate = this.#engineRange
        ? estimateRating(this.#matchBook.games, this.#settings.matchAnchorElo, this.#engineRange)
        : null;
      refs.estimate.textContent = estimate
        ? t("match.estimate", {
            n: estimate.games,
            wins: estimate.wins,
            draws: estimate.draws,
            losses: estimate.losses,
            rating: estimate.estimate,
            low: estimate.lower,
            high: estimate.upper,
            provisional: estimate.provisional ? t("match.provisional") : "",
            boundary: estimate.boundary ? t("match.boundary") : "",
          })
        : t("match.noGames");
    }
    if (refs.scale) refs.scale.textContent = t("match.scale");
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
    // Black-screen safety: ensure visible immediately
    try {
      document.body?.classList.remove("theme-loading");
    } catch {
      void 0;
    }
    try {
      document.documentElement.style.background = "";
    } catch {
      void 0;
    }

    try {
      // Load settings with fallback
      let storedSettings = {};
      try {
        storedSettings = await readValue(SETTINGS_KEY, {});
      } catch (e) {
        log.warn("settings read failed", e);
        storedSettings = {};
      }
      this.#settings = mergeSettings(storedSettings);
      this.#engineLevel = this.#settings.engineLevel;
      this.#clockState = createClock(this.#settings.clockDurationMs);
      this.#boardView.setInteraction?.(this.#settings.moveInteraction);
      if (this.#settings.paused) {
        this.#engineWorker?.terminate();
        this.#engineWorker = null;
      }
      // Corrupt match storage cannot prevent the board/library from starting.
      try {
        this.#matchBook = await readMatches();
      } catch {
        this.#matchBook = emptyMatches();
      }

      // Apply theme immediately and cache to localStorage to prevent flash
      try {
        this.#applyTheme();
      } catch (e) {
        log.warn("applyTheme failed", e);
      }
      try {
        this.#cacheTheme();
      } catch {
        void 0;
      }

      // Init i18n with resolved locale
      try {
        const effectiveLocale = resolveLocale(this.#settings.locale);
        this.#locale = effectiveLocale;
        this.#t = createTranslator(effectiveLocale);
        this.#applyI18n();
      } catch (e) {
        log.warn("i18n init failed", e);
        this.#t = createTranslator("en");
        this.#locale = "en";
      }

      // Load library
      try {
        this.#library = await readLibrary();
      } catch {
        this.#library = { version: 2, games: [] };
      }

      // Restore game snapshot with migration — never throw
      try {
        const snapshot = await readValue(GAME_KEY, null);
        if (this.#settings.persistGame && snapshot) {
          this.#session = GameSession.fromSnapshot(snapshot, { playerColor: this.#settings.playerColor });
          log.info(`restored a game with ${this.#session.plyCount} plies (v${snapshot.version || 1}→v2)`);
        } else {
          this.#session = new GameSession({ playerColor: this.#settings.playerColor });
        }
      } catch (e) {
        log.warn("snapshot restore failed, starting fresh", e);
        try {
          await removeValue(GAME_KEY);
        } catch {
          void 0;
        }
        this.#session = new GameSession({ playerColor: this.#settings.playerColor });
      }

      try {
        this.#applySettingsToDialog();
      } catch (e) {
        log.warn("applySettingsToDialog failed", e);
      }

      try {
        this.#render();
      } catch (e) {
        log.warn("initial render failed", e);
        // Try minimal render
        try {
          const statusNode = this.#refs.status;
          if (statusNode) {
            statusNode.textContent = "Board failed to render — try New Game or check console.";
            statusNode.dataset.kind = "error";
          }
        } catch {
          void 0;
        }
      }

      try {
        this.#renderLibrary();
      } catch {
        void 0;
      }

      // Dismissible first-run note (local only, never intrusive).
      try {
        this.#initFirstRun();
      } catch {
        void 0;
      }

      try {
        await this.refreshConnection();
      } catch (e) {
        log.debug("refreshConnection failed", e);
      }
      if (!this.#settings.paused) void this.#bootStockfish();
      else this.#renderMatch();

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
        try {
          this.#startClockTick();
        } catch {
          void 0;
        }
      }

      // A persisted battle restores PAUSED with Resume — never auto-continue.
      try {
        const ledger = await readValue(BATTLE_LEDGER_KEY, {});
        this.#battleLedger = ledger && typeof ledger === "object" ? ledger : {};
        await this.#restoreBattleFromStorage();
      } catch (e) {
        log.warn("battle restore failed", e);
      }
    } catch (error) {
      log.error("start() fatal error", error);
      this.#message = `Startup failed: ${error?.message || error}. Try New Game or reset settings.`;
      this.#phase = Phase.ERROR;
      try {
        this.#render();
      } catch {
        void 0;
      }
    } finally {
      try {
        document.body.classList.remove("theme-loading");
      } catch {
        void 0;
      }
      try {
        document.documentElement.style.background = "";
      } catch {
        void 0;
      }
      // Extra safety: force visible after short delay
      try {
        setTimeout(() => {
          try {
            document.body?.classList.remove("theme-loading");
          } catch {
            void 0;
          }
        }, 100);
      } catch {
        void 0;
      }
    }
  }

  /** Shows the one-paragraph first-run note until the user dismisses it. */
  #initFirstRun() {
    const note = this.#el("first-run");
    if (!note) return;
    let dismissed = false;
    try {
      dismissed = Boolean(localStorage.getItem("ai-chess-companion-onboarded"));
    } catch {
      return; // storage unavailable — never nag without a way to persist
    }
    if (dismissed) return;
    note.hidden = false;
    const text = this.#el("first-run-text");
    if (text) text.textContent = this.#t("firstRun.text");
    const dismiss = this.#el("first-run-dismiss");
    if (dismiss && !dismiss.dataset.bound) {
      dismiss.dataset.bound = "1";
      dismiss.textContent = this.#t("firstRun.dismiss");
      dismiss.addEventListener("click", () => {
        note.hidden = true;
        try {
          localStorage.setItem("ai-chess-companion-onboarded", "1");
        } catch {
          // ignore
        }
      });
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
    try {
      document.body.dataset.theme = resolved;
      document.body.dataset.boardTheme = this.#settings.boardTheme;
      document.body.dataset.fontScale = this.#settings.fontScale;
      document.body.dataset.density = this.#settings.density;
      document.body.dataset.interface = this.#settings.interfaceDetail;
    } catch {
      void 0;
    }
    try {
      document.body.classList.remove("theme-loading");
    } catch {
      void 0;
    }
    try {
      document.documentElement.style.background = "";
    } catch {
      void 0;
    }
  }

  #applyI18n() {
    if (!this.#t) return;
    const t = this.#t;
    // Update static UI text via textContent (never innerHTML)
    const setText = (id, key, params) => {
      const el = this.#el(id);
      if (el) {
        el.textContent = t(key, params);
      }
    };
    setText("app-title", "app.title");
    setText("app-eyebrow", "app.eyebrow");
    const staticLabels = {
      "turn-label": "meta.turn",
      "opponent-label": "meta.opponent",
      "clock-white-label": "clock.white",
      "clock-black-label": "clock.black",
      undo: "controls.undo",
      "new-game": "controls.newGame",
      flip: "controls.flip",
      hint: "analysis.hintButton",
      "analyse-game": "analysis.analyseGame",
      "copy-prompt": "status.copyPrompt",
      "reload-tab": "status.reloadTab",
      "connections-title": "connections.title",
      "connections-hint": "connections.hint",
      "refresh-tabs": "connections.refresh",
      "unpin-tab": "connections.unpin",
      "open-platform": "connections.openTab",
      "moves-title": "moves.title",
      "moves-empty": "moves.empty",
      "copy-pgn": "controls.copyPgn",
      "open-pgn": "controls.openPgn",
      "library-title": "library.title",
      "library-empty": "library.empty",
      "library-import": "library.import",
      "library-export-all": "library.exportAll",
      "library-new": "library.new",
      "analysis-title": "analysis.title",
      "analysis-hint": "analysis.hint",
      "analysis-heuristic-note": "analysis.heuristicNote",
      "engine-level-label": "analysis.strength",
      "play-vs-engine": "analysis.playVsEngine",
      "stop-engine": "analysis.stopEngine",
      "position-title": "position.title",
      "copy-fen": "controls.copyFen",
      "paste-fen": "controls.pasteFen",
      "copy-position": "controls.copyPosition",
      "open-settings": "controls.settings",
      "diagnostics-title": "diagnostics.title",
      "copy-diagnostics": "diagnostics.copyReport",
      "promotion-title": "promotion.title",
      "settings-title": "settings.title",
      "settings-theme-label": "settings.theme",
      "settings-locale-label": "settings.locale",
      "settings-board-theme-label": "settings.boardTheme",
      "settings-font-scale-label": "settings.fontScale",
      "settings-density-label": "settings.density",
      "settings-play-as-label": "settings.playAs",
      "settings-reset": "settings.reset",
      "pgn-title": "pgn.title",
      "pgn-copy": "pgn.copy",
      "pgn-load": "pgn.load",
      "fen-dialog-title": "fen.setup",
      "fen-apply": "fen.apply",
      "shortcuts-title": "shortcuts.title",
      "library-rename-title": "library.renameGame",
      "library-rename-save": "generic.save",
      "match-title": "match.title",
      "match-scale": "match.scale",
      "settings-board-group": "settings.groupBoard",
      "settings-sound-group": "settings.groupSound",
      "settings-clock-group": "settings.groupClock",
      "settings-ai-group": "settings.groupAi",
      "settings-engine-group": "settings.groupEngine",
      "settings-max-retries-label": "settings.maxRetries",
      "settings-prompt-style-label": "settings.responseStyle",
      "settings-fun-sentences-label": "settings.funSentences",
      "settings-send-mode-label": "settings.sendMode",
      "settings-generation-wait-label": "settings.generationWait",
      "settings-sound-volume-label": "settings.soundVolume",
      "settings-clock-duration-label": "settings.clockDuration",
      "settings-engine-level-label": "settings.localLevel",
      "settings-stockfish-notice": "match.stockfishNotice",
      "match-anchor-label": "match.anchor",
      "match-movetime-label": "match.moveTime",
      "match-start": "match.start",
      "match-stop": "match.stop",
      "match-export": "match.export",
      "settings-hint": "settings.hint",
      "tools-title": "tools.title",
      "pin-change": "connections.change",
      "more-button": "controls.more",
      "more-title": "more.title",
      "more-settings": "controls.settings",
      "more-help": "shortcuts.title",
      "first-run-text": "firstRun.text",
      "first-run-dismiss": "firstRun.dismiss",
      "delivery-title": "delivery.title",
      "help-title": "help.title",
      "help-pinned-chat": "help.pinnedChat",
      "help-local-tools": "help.localTools",
      "help-rated": "help.rated",
      "rated-title": "match.ratedSection",
      "settings-interface-group": "settings.groupInterface",
      "settings-interface-detail-label": "settings.interfaceDetail",
      "settings-orientation-label": "settings.boardOrientation",
      "settings-move-format-label": "settings.moveListFormat",
      "settings-move-interaction-label": "settings.moveInteraction",
      "settings-waiting-reminder-label": "settings.waitingReminder",
      "settings-confirm-destructive-hint": "settings.confirmDestructiveHint",
      "settings-reminder-hint": "settings.reminderHint",
    };
    for (const [id, key] of Object.entries(staticLabels)) setText(id, key);
    for (const node of document.querySelectorAll("[data-i18n]")) {
      node.textContent = t(node.dataset.i18n);
    }
    this.#el("tab-list")?.setAttribute("aria-label", t("connections.tabList"));
    this.#el("switch-side")?.setAttribute("title", t("controls.switchSideTitle"));
    this.#el("board")?.setAttribute("aria-label", t("board.label"));
    this.#el("fen")?.setAttribute("aria-label", t("position.fen"));
    this.#el("library-search")?.setAttribute("placeholder", t("library.search"));
    this.#el("pgn-text")?.setAttribute("placeholder", t("pgn.placeholder"));
  }

  /**
   * Re-reads which tab the panel should talk to.
   *
   * @returns {Promise<void>}
   */
  async refreshConnection() {
    const epoch = ++this.#refreshEpoch;
    try {
      const response = await chrome.runtime.sendMessage(createMessage(MessageType.GET_CONNECTIONS));
      if (epoch !== this.#refreshEpoch) return;
      if (!response?.ok) throw new Error("Could not list the AI tabs.");
      this.#availableTabs = Array.isArray(response.tabs) ? response.tabs : [];
      const previousPin = this.#pin;
      this.#pin = response.pin || null;
      if (previousPin && !this.#pin) {
        if (this.#match) this.#abortMatch(this.#t("match.pinLost"));
        this.#cancelReply();
        this.#phase = Phase.ERROR;
        this.#message = this.#t("connections.pinLost");
      }
      this.#setConnection(this.#pin ? { ...this.#pin, supported: true } : null);
      this.#renderTabs();
      if (this.#pin?.tabId !== undefined) {
        try {
          const diag = await chrome.tabs.sendMessage(this.#pin.tabId, createMessage(MessageType.GET_DIAGNOSTICS));
          if (epoch !== this.#refreshEpoch) return;
          if (diag?.report) {
            this.#diagnostics = diag.report;
            this.#renderDiagnostics();
          }
        } catch {
          // Diagnostics are optional; a pinned tab can still receive an injection.
        }
      }
    } catch (error) {
      if (epoch !== this.#refreshEpoch) return;
      log.debug("could not list the supported tabs", describeRuntimeError(error));
      this.#pin = null;
      this.#setConnection(null);
      this.#renderTabs();
    }
    this.#render();
  }

  #renderTabs() {
    const { list, pinned, unpin } = this.#refs.platformBanner;
    if (unpin) unpin.hidden = !this.#pin;
    if (pinned) {
      pinned.textContent = this.#pin
        ? this.#t("connections.pinned", {
            platform: this.#connection.label,
            title: this.#pin.title || `#${this.#pin.tabId}`,
          })
        : this.#t("connections.choosePin");
    }
    if (!list) return;
    const fragment = document.createDocumentFragment();
    if (!this.#availableTabs.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = this.#t("connections.noTabs");
      fragment.append(empty);
    }
    for (const tab of this.#availableTabs) {
      if (!Number.isInteger(tab.tabId) || !platformForUrl(tab.url)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tab-row${this.#pin?.tabId === tab.tabId ? " is-pinned" : ""}`;
      button.dataset.tabId = String(tab.tabId);
      button.setAttribute("aria-pressed", String(this.#pin?.tabId === tab.tabId));
      const name = document.createElement("span");
      name.className = "tab-title";
      name.textContent = `${this.#pin?.tabId === tab.tabId ? this.#t("connections.pinMarker") + " " : ""}${tab.platform || platformForUrl(tab.url).name} — ${tab.title || `#${tab.tabId}`}`;
      const host = document.createElement("span");
      host.className = "tab-host";
      host.textContent = tab.host || new URL(tab.url).host;
      button.append(name, host);
      fragment.append(button);
    }
    list.replaceChildren(fragment);
  }

  async pinTab(tabId) {
    const epoch = ++this.#pinMutationEpoch;
    ++this.#refreshEpoch; // an older tab-list response cannot restore the old pin
    if (this.#match && tabId !== this.#match.tabId) this.#abortMatch(this.#t("match.pinLost"));
    if (this.#pin?.tabId !== tabId) this.#cancelReply();
    const response = await chrome.runtime.sendMessage(createMessage(MessageType.PIN_TAB, { tabId }));
    if (epoch !== this.#pinMutationEpoch) return;
    if (!response?.ok) {
      this.#phase = Phase.ERROR;
      this.#message = this.#t("connections.pinFailed");
    } else {
      this.#pin = response.pin;
      this.#setConnection({ ...response.pin, supported: true });
      this.#message = this.#t("connections.pinned", {
        platform: this.#connection.label,
        title: this.#pin.title || `#${tabId}`,
      });
      this.#phase = Phase.IDLE;
    }
    await this.refreshConnection();
  }

  async unpinTab() {
    const epoch = ++this.#pinMutationEpoch;
    ++this.#refreshEpoch;
    if (this.#match) this.#abortMatch(this.#t("match.pinLost"));
    this.#cancelReply();
    await chrome.runtime.sendMessage(createMessage(MessageType.UNPIN_TAB));
    if (epoch !== this.#pinMutationEpoch) return;
    this.#pin = null;
    this.#setConnection(null);
    this.#message = this.#t("connections.unpinned");
    this.#phase = Phase.IDLE;
    await this.refreshConnection();
  }

  /**
   * Plays the human's move, or updates the selection.
   *
   * @param {number} square
   * @returns {Promise<void>}
   */
  async selectSquare(square) {
    if (this.#busy || this.#settings.paused || this.#matchFinished) {
      log.debug("busy, paused or finished, ignoring selectSquare");
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
    if (this.#busy || this.#settings.paused || this.#matchFinished) return;
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

  /** A parsed reply delivered ONLY by the expected pinned content script. */
  async handleAiMove(payload) {
    const session = this.#session;
    if (this.#settings.paused || this.#matchFinished || session.isGameOver) return;
    if (this.#match && (session.turn !== this.#match.aiColor || this.#connection.tabId !== this.#match.tabId)) return;
    if (payload.diagnostics) {
      this.#diagnostics = payload.diagnostics;
      this.#latency.mergeExternal(payload.diagnostics.stages);
      this.#renderDiagnostics();
    }
    this.#clearWaitingReminder();
    this.#expectedReplyId = null;

    if (payload.resigned) {
      if (this.#match && this.#match.stockfishMoves > 0 && this.#match.chatMoves > 0) {
        await this.#finishMatch(this.#match.engineColor === "w" ? "1-0" : "0-1", "resignation");
      } else if (this.#match) {
        this.#abortMatch(this.#t("match.unratedProtocol"));
      } else {
        this.#phase = Phase.ERROR;
        this.#message = this.#t("status.aiResigned");
        this.#render();
      }
      return;
    }
    if (payload.repeated && payload.move) {
      await this.#retryAfterIllegalMove(payload.move, { code: IllegalReason.REPEATED_MOVE, facts: {} });
      return;
    }
    if (payload.noMove) {
      await this.#retryAfterIllegalMove(this.#t("status.noMove"), { code: IllegalReason.MALFORMED, facts: {} });
      return;
    }

    const candidates = normaliseCandidates(payload);
    if (!candidates.length) {
      await this.#retryAfterIllegalMove(this.#t("status.noMove"), { code: IllegalReason.MALFORMED, facts: {} });
      return;
    }
    this.#latency.mark("parsed");
    // First bracketed UCI wins; a rejected first answer must not let a later
    // quoted example or legal-list item masquerade as the actual reply.
    if (session.rejectedMoves.includes(candidates[0])) {
      await this.#retryAfterIllegalMove(candidates[0], { code: IllegalReason.REPEATED_MOVE, facts: {} });
      return;
    }
    const result = session.playFirstAvailable([candidates[0]]);
    if (result.ok) {
      this.#latency.mark("accepted");
      this.#phase = Phase.IDLE;
      this.#message = "";
      this.#lastIllegalReply = null;
      this.#clearSelection();
      this.#hintMove = null;
      this.#delivery = { state: DeliveryState.ANSWERED };
      this.#hideCopyPrompt();
      this.#hideReloadTab();
      if (this.#match) this.#match.chatMoves += 1;
      this.#persist();
      this.#render();
      this.#latency.mark("rendered");
      this.#latency.finish();
      this.#updateClockAfterMove(); // clock state is correctness-critical
      scheduleOffPath(() => {
        this.#updateBadge();
        this.#playSoundForMove(result.entry);
        this.#announceMove(result.entry);
      });
      if (session.isGameOver) {
        // Terminal board result: invalidate every in-flight callback of the
        // request that produced this reply. A late acknowledgement, timeout or
        // submit failure must not replace the checkmate (or draw) on screen.
        this.#cancelReply();
        this.#hideCopyPrompt();
        this.#hideReloadTab();
        this.#render();
      }
      if (this.#match) {
        if (session.outcome.over) await this.#finishMatch(session.outcome.result, session.outcome.reason);
        else await this.#advanceMatch();
      }
      return;
    }
    if (result.code === MoveError.NOT_AI_TURN) {
      this.#message = this.#t("status.outOfTurn", { move: candidates[0] });
      this.#render();
      return;
    }
    if (result.code === MoveError.ILLEGAL) {
      await this.#retryAfterIllegalMove(
        candidates[0],
        result.reason || explainIllegalMove(session.position, candidates[0]),
      );
    }
  }

  #playSoundForMove(entry) {
    if (!this.#settings.soundEnabled) return;
    try {
      if (entry.mate) {
        playSound("gameOver", this.#settings.soundVolume);
      } else if (entry.check) {
        playSound("check", this.#settings.soundVolume);
      } else if (entry.promotion) {
        playSound("promotion", this.#settings.soundVolume);
      } else if (/^O-O/.test(entry.san)) {
        playSound("castle", this.#settings.soundVolume);
      } else if (entry.san.includes("x")) {
        playSound("capture", this.#settings.soundVolume);
      } else {
        playSound("move", this.#settings.soundVolume);
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
    const color = this.#t(entry.color === "w" ? "clock.white" : "clock.black");
    this.#announce(this.#t("analysis.moveAnnouncement", { color, san: entry.san, uci: entry.uci }));
  }

  /**
   * Asks the AI to move in the current position. Used when the player takes
   * Black, after a page reload, and by the "ask again" action.
   *
   * @returns {Promise<void>}
   */
  async requestAiMove() {
    if (
      this.#busy ||
      this.#retryPending ||
      this.#match ||
      this.#matchFinished ||
      this.#settings.paused ||
      this.#localEngineMode ||
      this.#expectedReplyId !== null
    )
      return; // an unanswered one-shot request must never be sent a second time
    if (this.#session.isGameOver || this.#session.isPlayerTurn) return;
    // After an illegal reply, Ask again is ONE corrective prompt, not another
    // opening/move request and not a new automatic retry cycle.
    const correction = this.#phase === Phase.ERROR ? this.#lastIllegalReply : null;
    const prompt = correction
      ? this.#correctionPrompt(correction.uci, correction.reason)
      : buildTurnPrompt(this.#turnPromptContext());
    await this.#sendPrompt(prompt, { expected: "ai-move" });
  }

  /** Starts a new game with the configured colour. */
  resetGame() {
    if (
      this.#settings.confirmDestructive &&
      this.#session.plyCount > 0 &&
      typeof globalThis.confirm === "function" &&
      !globalThis.confirm(this.#t("controls.confirmNewGame"))
    ) {
      return;
    }
    if (this.#match) this.#abortMatch(this.#t("match.unratedStopped"));
    this.#cancelReply();
    this.#matchFinished = false;
    this.#localEngineMode = false;
    this.#lastIllegalReply = null;
    // Store for undo
    this.#lastGameSnapshot = this.#session.snapshot();
    this.#session.reset({ playerColor: this.#settings.playerColor });
    this.#flipOverride = null;
    this.#clearSelection();
    this.#phase = Phase.IDLE;
    this.#message = this.#t("status.newGameGoodLuck");
    this.#delivery = null;
    this.#hideCopyPrompt();
    this.#hideReloadTab();
    this.#hintMove = null;
    this.#evalScore = null;
    this.#persist();
    this.#render();
    this.#updateBadge();
    this.#showUndoDelete(this.#t("status.gameResetUndo"), () => this.undoDeleteGame());
  }

  undoDeleteGame() {
    if (!this.#lastGameSnapshot) return;
    this.#session = GameSession.fromSnapshot(this.#lastGameSnapshot, { playerColor: this.#settings.playerColor });
    this.#lastGameSnapshot = null;
    this.#message = this.#t("status.gameRestored");
    this.#persist();
    this.#render();
    this.#updateBadge();
  }

  /** Undoes the last move pair. */
  undo() {
    if (this.#busy || this.#match) return;
    this.#cancelReply();
    this.#lastIllegalReply = null;
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
    if (this.#match) return { ok: false, error: this.#t("match.running") };
    if (
      this.#settings.confirmDestructive &&
      this.#session.plyCount > 0 &&
      typeof globalThis.confirm === "function" &&
      !globalThis.confirm(this.#t("controls.confirmReplaceGame"))
    ) {
      return { ok: false, error: this.#t("status.loadCancelled") };
    }
    this.#cancelReply();
    this.#matchFinished = false;
    this.#localEngineMode = false;
    this.#lastIllegalReply = null;
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
    this.#engineLevel = this.#settings.engineLevel;
    if (
      this.#match &&
      (previous.playerColor !== this.#settings.playerColor ||
        previous.sendMode !== this.#settings.sendMode ||
        previous.matchAnchorElo !== this.#settings.matchAnchorElo)
    ) {
      this.#abortMatch(this.#t("match.unratedStopped"));
    }
    this.#applySettingsToDialog();
    this.#applyTheme();
    this.#cacheTheme();
    this.#applyI18n();
    await writeValue(SETTINGS_KEY, this.#settings);

    if (previous.playerColor !== this.#settings.playerColor) {
      this.#cancelReply();
      this.#matchFinished = false;
      this.#localEngineMode = false;
      this.#lastIllegalReply = null;
      this.#flipOverride = null;
      this.#session.reset({ playerColor: this.#settings.playerColor });
      this.#message = this.#t("status.sideNewGame", {
        color: this.#t(this.#settings.playerColor === "w" ? "clock.white" : "clock.black"),
      });
      this.#phase = Phase.IDLE;
      this.#persist();
    }

    if (!this.#settings.persistGame) {
      await removeValue(GAME_KEY);
    }

    if (previous.clockEnabled !== this.#settings.clockEnabled) {
      if (this.#settings.clockEnabled) {
        this.#clockState = createClock(this.#settings.clockDurationMs);
        this.#startClockTick();
      } else {
        clearInterval(this.#clockTimer);
        this.#clockTimer = 0;
      }
    }

    if (previous.clockDurationMs !== this.#settings.clockDurationMs) {
      this.#clockState = createClock(this.#settings.clockDurationMs);
    }
    if (previous.locale !== this.#settings.locale) {
      const effective = resolveLocale(this.#settings.locale);
      this.#locale = effective;
      this.#t = createTranslator(effective);
      this.#applyI18n();
      this.#renderTabs();
      this.#renderLibrary();
    }

    if (previous.boardOrientation !== this.#settings.boardOrientation) {
      // An explicit orientation choice supersedes any manual Flip override;
      // the Flip button then continues to work as a temporary reversal.
      this.#flipOverride = null;
    }

    if (previous.moveInteraction !== this.#settings.moveInteraction) {
      this.#boardView.setInteraction?.(this.#settings.moveInteraction);
    }

    if (previous.waitingReminderMs !== this.#settings.waitingReminderMs) {
      if (this.#phase === Phase.AWAITING && this.#expectedReplyId !== null) {
        this.#scheduleWaitingReminder();
      } else {
        this.#clearWaitingReminder();
      }
    }

    if (previous.paused !== this.#settings.paused) {
      if (this.#settings.paused) {
        this.#cancelReply();
        if (this.#match) this.#abortMatch(this.#t("match.unratedStopped"));
        this.#engineWorker?.terminate();
        this.#engineWorker = null;
        this.#stopStockfish();
        this.#clockState = stopClock(this.#clockState);
        this.#message = this.#t("status.paused");
      } else {
        this.#initEngine();
        void this.#bootStockfish();
        this.#message = this.#t("status.resumed");
      }
      this.#phase = Phase.IDLE;
      // Storage events also reach content scripts when the panel is closed.
      // The explicit message takes effect immediately on the pinned page.
      const tabs = this.#availableTabs.length ? this.#availableTabs : this.#pin ? [this.#pin] : [];
      await Promise.allSettled(
        tabs.map((tab) =>
          chrome.tabs.sendMessage(tab.tabId, createMessage(MessageType.SET_PAUSED, { paused: this.#settings.paused })),
        ),
      );
      void chrome.runtime.sendMessage(createMessage(MessageType.PAUSE_CHANGED)).catch(() => undefined);
    }

    this.#renderTabs();
    this.#renderMatch();
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
    const epoch = this.#retryEpoch;
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

    // The promotion dialog can stay open while a game is reset, paused or
    // replaced. The same GameSession object is mutated in place on reset.
    if (
      session !== this.#session ||
      epoch !== this.#retryEpoch ||
      this.#settings.paused ||
      this.#busy ||
      !session.isPlayerTurn
    )
      return;
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
    this.#lastIllegalReply = null;
    this.#persist();
    this.#updateClockAfterMove(); // clock state is correctness-critical
    scheduleOffPath(() => {
      this.#updateBadge();
      this.#playSoundForMove(result.entry);
      this.#announceMove(result.entry);
    });

    if (session.isGameOver) {
      // The human's move ended the game: no new chess prompt may be created,
      // typed, copied or sent — and any obsolete recovery affordance from an
      // earlier request must disappear with the terminal result.
      this.#phase = Phase.IDLE;
      this.#message = "";
      this.#delivery = null;
      this.#clearWaitingReminder();
      this.#hideCopyPrompt();
      this.#hideReloadTab();
      this.#render();
      return;
    }

    if (this.#localEngineMode) {
      await this.#playLocalEngineTurn();
      return;
    }
    this.#lastPrompt = this.#movePrompt();
    await this.#sendPrompt(this.#lastPrompt, { expected: "ai-move" });
  }

  /** @returns {string} a move request for the current position. */
  // =========================================================================
  // AI battle (UNRATED): two pinned AI tabs play one full clocked game. The
  // battle game is owned by GameSession exactly like a normal game; the local
  // engine NEVER plays a move in battle. One submit per tab per turn, replies
  // routed strictly by tab + requestId per side, illegal/no-move replies get
  // bounded per-side retries and then PAUSE — nothing is ever fabricated.
  // =========================================================================

  /** @type {any} */
  #battleState = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  #battleTimer = null;
  #battleCounter = 0;
  /** @type {Record<string, any>} */
  #battleLedger = {};

  /** Explicit user action: battles run only in Auto send mode. */
  async enableAutoSend() {
    await this.updateSettings({ sendMode: "auto" });
  }

  /**
   * Starts a battle between the MAIN pinned tab and a battle-only opponent
   * slot. Creates the opponent slot for the duration of the battle and tears
   * it down when the battle ends — the MAIN pin invariant is untouched.
   *
   * @param {{opponentTabId: number, opponentColor?: 'w'|'b', minutesPerSide?: number, incrementSec?: number, maxPlies?: number}} options
   * @param {{confirmed?: boolean}} [flow]
   */
  async startBattle(
    { opponentTabId, opponentColor = "b", minutesPerSide, incrementSec, maxPlies } = {},
    { confirmed = false } = {},
  ) {
    if (this.#settings.sendMode !== "auto") {
      this.#message = this.#t("battle.manualMode");
      this.#announce(this.#message);
      this.#render();
      return { ok: false, reason: "manual", canEnableAuto: true };
    }
    if (this.#battleState && !this.#battleState.finished) {
      return { ok: false, reason: "already-running" };
    }
    if (!this.#pin) {
      this.#message = this.#t("battle.needsMainPin");
      this.#render();
      return { ok: false, reason: "no-main-pin" };
    }
    if (opponentTabId === this.#pin.tabId) return { ok: false, reason: "same-tab" };
    if (this.#session.plyCount > 0 && !confirmed) {
      // Same confirm-and-replace contract as a rated match switch: only ever
      // after an explicit confirmation from the user.
      if (typeof globalThis.confirm === "function" && !globalThis.confirm(this.#t("controls.confirmReplaceGame"))) {
        this.#message = this.#t("battle.startCancelled");
        this.#render();
        return { ok: false, reason: "aborted" };
      }
    }
    // Battle-only opponent slot (parameterised pin machinery, no new hosts).
    const pinned = await chrome.runtime.sendMessage(
      createMessage(MessageType.PIN_TAB, { tabId: opponentTabId, slot: "opponent" }),
    );
    if (!pinned?.ok || !pinned.pin) {
      this.#message = this.#t("battle.pinFailed");
      this.#render();
      return { ok: false, reason: "pin-failed", error: pinned?.error || "" };
    }
    const oppColor = opponentColor === "w" ? "w" : "b";
    const mainSide = {
      tabId: this.#pin.tabId,
      slot: "main",
      platformId: this.#pin.platformId,
      label: this.#pin.label,
      title: this.#pin.title,
      url: this.#pin.url,
    };
    const oppSide = {
      tabId: pinned.pin.tabId,
      slot: "opponent",
      platformId: pinned.pin.platformId,
      label: pinned.pin.label || pinned.pin.platformId,
      title: pinned.pin.title,
      url: pinned.pin.url,
    };
    const sides = oppColor === "w" ? { w: oppSide, b: mainSide } : { w: mainSide, b: oppSide };
    // A fresh GameSession owns the battle game; the local engine is never
    // started for it (playBattleReply applies both sides' AI moves strictly).
    this.#session = new GameSession({ playerColor: oppColor === "w" ? "b" : "w" });
    this.#cancelReply();
    this.#matchFinished = false;
    this.#localEngineMode = false;
    this.#lastIllegalReply = null;
    this.#expectedReplyId = null;
    this.#retryPending = false;
    this.#delivery = { state: DeliveryState.NEVER };
    this.#latency = new LatencyTimeline();
    this.#phase = Phase.IDLE;
    this.#message = "";
    this.#battleState = {
      battle: createBattle({
        sides,
        minutesPerSide: minutesPerSide ?? this.#settings.battleMinutesPerSide,
        incrementSec: incrementSec ?? this.#settings.battleIncrementSec,
        maxPlies: maxPlies ?? this.#settings.battleMaxPlies,
      }),
      epoch: 1,
      pending: null,
      latency: null,
      paused: false,
      pauseReason: "",
      finished: false,
      moveSources: [],
      lastPrompts: { w: null, b: null },
    };
    void this.updateSettings({
      battleMinutesPerSide: this.#battleState.battle.minutesPerSide,
      battleIncrementSec: this.#battleState.battle.incrementSec,
      battleMaxPlies: this.#battleState.battle.maxPlies,
    });
    this.#startBattleTicking();
    await this.#persistBattleSnapshot();
    this.#render();
    void this.#battleDispatch();
    return { ok: true };
  }

  /** One-click rematch reusing both slots and the same color assignment. */
  async startRematch() {
    const bt = this.#battleState;
    if (!bt) return { ok: false, reason: "none" };
    const sides = bt.battle.sides;
    const oppColor = sides.w.slot === "opponent" ? "w" : "b";
    const opponentTabId = sides[oppColor].tabId;
    const settings = {
      opponentTabId,
      opponentColor: oppColor,
      minutesPerSide: bt.battle.minutesPerSide,
      incrementSec: bt.battle.incrementSec,
      maxPlies: bt.battle.maxPlies,
    };
    if (!bt.finished) {
      this.#battleFinish({ token: "*", reason: "aborted", winner: null }, { ledger: false });
    }
    this.#battleState = null;
    return this.startBattle(settings, { confirmed: true });
  }

  /** Soft pause (user): clock stops, outstanding callbacks are invalidated. */
  pauseBattle() {
    void this.#battlePause(this.#t("battle.pausedByUser"));
  }

  /** Resume is always an explicit user action — never auto-continue. */
  resumeBattle() {
    const bt = this.#battleState;
    if (!bt || bt.finished || !bt.paused) return;
    bt.paused = false;
    bt.epoch += 1;
    resumeBattleClock(bt.battle, this.#session.turn, Date.now());
    this.#message = "";
    this.#render();
    void this.#battleDispatch();
  }

  /** Explicit recovery: re-send the SAME prompt to the side to move. */
  askBattleAgain() {
    const bt = this.#battleState;
    if (!bt || bt.finished) return;
    bt.paused = false;
    bt.epoch += 1;
    resumeBattleClock(bt.battle, this.#session.turn, Date.now());
    const side = this.#session.turn;
    const prompt =
      bt.lastPrompts[side] ||
      buildTurnPrompt(
        this.#turnPromptContext({
          aiColor: side,
          opponentIsAi: true,
          battleClock: {
            remainingMs: battleRemainingMs(bt.battle.clock, side),
            incrementSec: bt.battle.incrementSec,
          },
        }),
      );
    const requestId = `battle-${bt.epoch}-${++this.#battleCounter}`;
    bt.pending = { side, requestId, prompt };
    this.#message = "";
    this.#render();
    void this.#battleSend(side, prompt, requestId);
  }

  /** Abort: aborted-unfinished, NO ledger entry. */
  abortBattle() {
    const bt = this.#battleState;
    if (!bt) return { ok: false };
    if (bt.finished) {
      void chrome.runtime.sendMessage(createMessage(MessageType.UNPIN_TAB, { slot: "opponent" }));
      return { ok: true };
    }
    this.#battleFinish({ token: "*", reason: "aborted", winner: null }, { ledger: false });
    this.#message = this.#t("battle.aborted");
    this.#announce(this.#message);
    this.#render();
    return { ok: true };
  }

  /** Paired PGN export for the current battle — names both tabs. */
  exportBattlePaired() {
    const bt = this.#battleState;
    if (!bt) return null;
    const pgns = pairedPgns(bt.battle, this.#session);
    return {
      filename: `ai-chess-companion-battle-${new Date(bt.battle.createdAt).toISOString().slice(0, 10)}.pgn`,
      text: `${pgns.w.trim()}\n\n${pgns.b.trim()}\n`,
    };
  }

  /** Export all recorded battles (both perspectives each). */
  exportBattlesAll() {
    const lines = [];
    for (const pair of Object.values(this.#battleLedger)) {
      for (const item of pair?.history ?? []) {
        if (item?.pgns?.w) lines.push(item.pgns.w.trim(), item.pgns.b.trim());
      }
    }
    if (lines.length === 0) return null;
    return {
      filename: `ai-chess-companion-battles-${new Date().toISOString().slice(0, 10)}.pgn`,
      text: `${lines.join("\n\n")}\n`,
    };
  }

  /** @param {number} epoch */
  #battleValid(epoch) {
    return Boolean(this.#battleState && this.#battleState.epoch === epoch && !this.#battleState.finished);
  }

  #battleCancelOutstanding() {
    const bt = this.#battleState;
    if (!bt) return;
    for (const side of ["w", "b"]) {
      const tabId = bt.battle.sides[side]?.tabId;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, createMessage(MessageType.CANCEL_REPLY)).catch(() => {});
      }
    }
  }

  async #battlePause(reasonText) {
    const bt = this.#battleState;
    if (!bt || bt.finished) return;
    bt.paused = true;
    bt.pauseReason = reasonText;
    bt.epoch += 1;
    this.#battleCancelOutstanding();
    pauseBattleClock(bt.battle, Date.now());
    bt.pending = null;
    await this.#persistBattleSnapshot();
    this.#message = reasonText;
    this.#announce(this.#message);
    this.#render();
  }

  #battleFinish(result, { ledger = true } = {}) {
    const bt = this.#battleState;
    if (!bt || bt.finished) return;
    bt.battle.result = result;
    bt.battle.status = "finished";
    bt.battle.clock.running = null;
    bt.finished = true;
    bt.paused = false;
    bt.pending = null;
    bt.epoch += 1;
    this.#battleCancelOutstanding();
    if (this.#battleTimer) {
      clearInterval(this.#battleTimer);
      this.#battleTimer = null;
    }
    const clocksMs = { whiteMs: bt.battle.clock.whiteMs, blackMs: bt.battle.clock.blackMs };
    if (ledger && result.reason !== "aborted") {
      // Aborted-unfinished battles NEVER enter the ledger.
      const entry = {
        pairKey: battlePairKey(bt.battle.sides),
        sides: bt.battle.sides,
        result,
        clocksMs,
        date: new Date().toISOString(),
        pgns: pairedPgns(bt.battle, this.#session),
      };
      this.#battleLedger = recordBattleResult(this.#battleLedger, entry);
      void writeValue(BATTLE_LEDGER_KEY, this.#battleLedger);
    }
    void chrome.runtime.sendMessage(createMessage(MessageType.UNPIN_TAB, { slot: "opponent" }));
    void removeValue(BATTLE_SNAPSHOT_KEY);
    this.#message =
      result.reason === "aborted"
        ? this.#t("battle.aborted")
        : this.#t("battle.finished", { result: result.token, reason: result.reason });
    this.#announce(this.#message);
    this.#render();
  }

  #battleFinishFromGame() {
    const last = this.#session.lastMove;
    const result = last?.mate
      ? gameEndResult(last.color === "w" ? "1-0" : "0-1", last.color, "checkmate")
      : gameEndResult("1/2-1/2", null, "draw");
    this.#battleFinish(result);
  }

  #battleFinishOnFlag(flaggedSide) {
    const bt = this.#battleState;
    if (!bt || bt.finished) return;
    this.#battleFinish(flagResult(bt.battle, flaggedSide));
  }

  #startBattleTicking() {
    if (this.#battleTimer) clearInterval(this.#battleTimer);
    this.#battleTimer = setInterval(() => {
      const bt = this.#battleState;
      if (!bt || bt.finished || bt.paused) return;
      const { flaggedSide } = tickBattle(bt.battle, Date.now());
      // Flag = LOSS immediately, even mid-send (epoch bump invalidates it).
      if (flaggedSide) this.#battleFinishOnFlag(flaggedSide);
    }, 250);
  }

  async #persistBattleSnapshot() {
    const bt = this.#battleState;
    if (!bt || bt.finished) return;
    await writeValue(BATTLE_SNAPSHOT_KEY, serializeBattle(bt.battle, this.#session));
  }

  async #restoreBattleFromStorage() {
    const value = await readValue(BATTLE_SNAPSHOT_KEY, null);
    if (!value || typeof value !== "object" || !value.battle || !value.sessionSnapshot) return;
    const restored = restoreBattle(value);
    const mainColor = restored.battle.sides.w.slot === "main" ? "w" : "b";
    this.#session = GameSession.fromSnapshot(restored.sessionSnapshot, { playerColor: mainColor });
    this.#battleState = {
      battle: restored.battle,
      epoch: 1,
      pending: null,
      latency: null,
      paused: true,
      pauseReason: this.#t("battle.restored"),
      finished: false,
      moveSources: [...this.#session.history].map((m) => m.source),
      lastPrompts: { w: null, b: null },
    };
    this.#message = this.#t("battle.restored");
    this.#announce(this.#message);
    this.#startBattleTicking();
  }

  #battleDispatch() {
    const bt = this.#battleState;
    if (!bt || bt.paused || bt.finished) return;
    const session = this.#session;
    if (session.isGameOver) return this.#battleFinishFromGame();
    const adjudicated = adjudicateIfNeeded(bt.battle, session.plyCount);
    if (adjudicated) return this.#battleFinish(adjudicated);
    const side = session.turn;
    const battleClock = {
      remainingMs: battleRemainingMs(bt.battle.clock, side),
      incrementSec: bt.battle.incrementSec,
    };
    const prompt = buildTurnPrompt(this.#turnPromptContext({ aiColor: side, opponentIsAi: true, battleClock }));
    bt.lastPrompts[side] = prompt;
    const requestId = `battle-${bt.epoch}-${++this.#battleCounter}`;
    bt.pending = { side, requestId, prompt };
    void this.#battleSend(side, prompt, requestId);
  }

  /**
   * ONE submit per prompt per tab. Fail-closed on any delivery doubt: a battle
   * PAUSES with per-side detail instead of continuing blind.
   */
  async #battleSend(side, prompt, requestId) {
    const bt = this.#battleState;
    if (!bt) return;
    const epoch = bt.epoch;
    const target = bt.battle.sides[side];
    this.#latency.begin();
    bt.latency = this.#latency;
    this.#latency.mark("queued");
    try {
      await this.#ensureContentScript(target.tabId, target.url, target.platformId);
    } catch {
      // content injection can fail for privileged pages; the send surfaces it
    }
    this.#latency.mark("dispatched");
    let response = null;
    let threw = false;
    try {
      response = await chrome.tabs.sendMessage(
        target.tabId,
        createMessage(MessageType.SEND_CHESS_PROMPT, {
          id: "battle-move",
          requestId,
          message: { prompt, expected: requestId, match: true },
        }),
      );
    } catch {
      threw = true;
      response = { ok: false, error: "messaging failed" };
    }
    this.#latency.mark("submitted");
    this.#latency.mergeExternal(response?.diagnostics?.stages);
    if (!this.#battleValid(epoch)) return; // flag/abort/pause invalidated this send
    // Battle is strict on delivery: ANY doubt pauses with per-side detail.
    const envelope = normaliseResponse(response);
    const unconfirmed = response?.unconfirmed === true || response?.result === "submit-unconfirmed";
    const contradicted = response?.result === "cancelled" || response?.contradiction === true;
    if (contradicted) {
      return this.#battlePause(`${target.label}: ${this.#t("battle.deliveryContradicted")}`);
    }
    if (unconfirmed || response?.manual) {
      return this.#battlePause(`${target.label}: ${this.#t("battle.deliveryUnconfirmed")}`);
    }
    if (!envelope.ok) {
      const detail = envelope.error || (threw ? this.#t("battle.deliveryUnreachable") : "");
      return this.#battlePause(`${target.label}: ${detail || this.#t("battle.deliveryFailed")}`);
    }
    return; // confirmed — one submit fired; the reply arrives via AI_MOVE
  }

  /** @returns {boolean} true when the payload was a battle reply and is handled. */
  #handleBattleReply(payload, sender) {
    const bt = this.#battleState;
    if (!bt || bt.paused || bt.finished || !bt.pending) return false;
    const { side, requestId } = bt.pending;
    const target = bt.battle.sides[side];
    // Strict routing: that side's tab + that side's request, nothing else.
    if (sender?.tab?.id !== target.tabId || payload?.requestId !== requestId) return false;
    this.#latency.mergeExternal(payload?.diagnostics?.stages);
    this.#latency.mark("reply-detected");
    if (payload?.type === MessageType.AI_NO_MOVE || !payload?.move) {
      void this.#battleRetry(side, "", this.#t("battle.noMove"));
      return true;
    }
    if (payload?.resigned) {
      this.#battleFinish(resignationResult(side));
      return true;
    }
    this.#latency.mark("parsed");
    const candidates = normaliseCandidates(payload).map((uci) => ({ uci, san: "" }));
    const result = this.#session.playBattleReply(candidates);
    if (!result.ok) {
      void this.#battleRetry(side, String(payload.move).slice(0, 120), result.error || this.#t("battle.illegal"));
      return true;
    }
    bt.moveSources.push(result.play.source); // always "ai"
    this.#latency.mark("accepted");
    completeMove(bt.battle, side, Date.now());
    bt.battle.retries[side] = 0;
    bt.pending = null;
    this.#render();
    this.#latency.mark("rendered");
    this.#latency.finish();
    void this.#persistBattleSnapshot();
    const adjudicated = adjudicateIfNeeded(bt.battle, this.#session.plyCount);
    if (adjudicated) {
      this.#battleFinish(adjudicated);
      return true;
    }
    if (this.#session.isGameOver) {
      this.#battleFinishFromGame();
      return true;
    }
    void this.#battleDispatch();
    return true;
  }

  /** Illegal/no-move: bounded per-side retries, then PAUSE — never fabricate. */
  #battleRetry(side, rawMove, _reasonText) {
    const bt = this.#battleState;
    if (!bt || bt.paused || bt.finished) return;
    const max = this.#settings.maxRetries ?? 3;
    bt.battle.retries[side] = (bt.battle.retries[side] ?? 0) + 1;
    if (bt.battle.retries[side] > max) {
      void this.#battlePause(`${bt.battle.sides[side].label}: ${this.#t("battle.pausedIllegal", { count: max })}`);
      return;
    }
    const cleaned = String(rawMove || "")
      .trim()
      .toLowerCase();
    // An empty probe returns the authoritative legal UCI list without mutating.
    const { legalUcis } = this.#session.playBattleReply([]);
    const prompt = buildRetryPrompt({
      fen: this.#session.fen,
      uci: /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(cleaned) ? cleaned : "",
      aiColor: side,
      history: formatMoveList(this.#session.history, { maxPlies: 12 }),
      legalMoves: legalUcis,
      rejectedMoves: this.#session.rejectedMoves,
      style: this.#settings.promptStyle,
      funSentences: this.#settings.funCommentarySentences,
      battleClock: {
        remainingMs: battleRemainingMs(bt.battle.clock, side),
        incrementSec: bt.battle.incrementSec,
      },
    });
    bt.lastPrompts[side] = prompt;
    const requestId = `battle-${bt.epoch}-${++this.#battleCounter}`;
    bt.pending = { side, requestId, prompt };
    void this.#battleSend(side, prompt, requestId);
  }

  /** Test hooks (same pattern as the pin-pause harness hooks). */
  __battleState() {
    const bt = this.#battleState;
    if (!bt) return null;
    return {
      paused: bt.paused,
      pauseReason: bt.pauseReason,
      finished: bt.finished,
      result: bt.battle.result,
      status: bt.battle.status,
      clock: { ...bt.battle.clock },
      moveSources: [...bt.moveSources],
      sessionSnapshot: this.#session.snapshot(),
    };
  }

  __battleTest({ clock = {}, now = Date.now() } = {}) {
    const bt = this.#battleState;
    if (!bt) return null;
    Object.assign(bt.battle.clock, clock);
    const { flaggedSide } = tickBattle(bt.battle, now);
    if (flaggedSide) this.#battleFinishOnFlag(flaggedSide);
    return bt.battle;
  }

  #movePrompt() {
    return buildTurnPrompt(this.#turnPromptContext());
  }

  #correctionPrompt(illegalMove, reason) {
    const session = this.#session;
    return buildRetryPrompt({
      fen: session.fen,
      uci: illegalMove,
      aiColor: session.aiColor,
      history: session.moveListText,
      reason,
      legalMoves: session.position.legalMoves().map(toUci),
      rejectedMoves: session.rejectedMoves,
      style: this.#settings.promptStyle,
      funSentences: this.#settings.funCommentarySentences,
    });
  }

  async #retryAfterIllegalMove(illegalMove, reason) {
    const session = this.#session;
    this.#lastIllegalReply = { uci: illegalMove, reason };
    const explanation = this.#t(`illegal.${reason.code}`, reason.facts);
    const canRetry = this.#settings.autoRetry && session.retryCount < this.#settings.maxRetries;
    this.#message = this.#t("status.illegalReason", { move: illegalMove, reason: explanation });
    if (!canRetry) {
      this.#phase = Phase.ERROR;
      if (this.#match) this.#abortMatch(`${this.#message} ${this.#t("match.unratedProtocol")}`);
      else this.#render();
      return;
    }

    const attempt = session.registerRetry();
    const prompt = this.#correctionPrompt(illegalMove, reason);
    this.#phase = Phase.ERROR;
    this.#render(); // display the concrete broken rule during backoff
    const backoff = Math.min(500 * Math.pow(2, attempt - 1), 2000);
    const epoch = this.#retryEpoch;
    const token = ++this.#retryToken;
    const match = this.#match;
    this.#retryPending = true;
    try {
      await new Promise((resolve) => {
        window.setTimeout(resolve, backoff);
      });
      if (
        epoch !== this.#retryEpoch ||
        this.#settings.paused ||
        (match && (this.#match !== match || this.#connection.tabId !== match.tabId))
      )
        return;
      const sent = await this.#sendPrompt(prompt, {
        expected: "ai-move",
        retry: attempt,
        match: Boolean(match),
        reasonText: explanation,
      });
      if (!sent && match && this.#match === match) this.#abortMatch(this.#t("match.unratedProtocol"));
    } finally {
      if (token === this.#retryToken) this.#retryPending = false;
      this.#render();
    }
  }

  /**
   * Serialize requests: even a fast AI reply cannot overlap two bridge sends.
   * The only waits in this chain are correctness waits (a prior send must
   * finish; `#cancelPending` must land before a new request starts) — never
   * arbitrary delays.
   */
  async #sendPrompt(prompt, options = {}) {
    const epoch = this.#retryEpoch;
    const session = this.#session;
    while (this.#sendInFlight) await this.#sendInFlight;
    if (epoch !== this.#retryEpoch || session !== this.#session) return false;
    const operation = this.#sendPromptOnce(prompt, options);
    this.#sendInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.#sendInFlight === operation) this.#sendInFlight = null;
    }
  }

  /** Send to the live, explicitly pinned tab only. Never follow focus. */
  async #sendPromptOnce(prompt, { expected = "prompt", retry = 0, match = false, reasonText = "" } = {}) {
    if ((this.#busy && !match) || this.#settings.paused || this.#expectedReplyId !== null) {
      if (this.#settings.paused) {
        this.#message = this.#t("status.paused");
        this.#showCopyPrompt(prompt);
        this.#render();
      }
      return false;
    }
    if (!this.#connection.supported || !Number.isInteger(this.#connection.tabId)) {
      this.#phase = Phase.ERROR;
      this.#message = this.#t("connections.choosePin");
      this.#showCopyPrompt(prompt);
      this.#render();
      return false;
    }

    const epoch = this.#retryEpoch;
    const tabId = this.#connection.tabId;
    const platformId = this.#connection.platform;
    /** Assigned once the bridge call is issued; null if it never started. */
    let requestId = null;
    if (!match) this.#busy = true;
    try {
      // An earlier cancellation MUST arrive before this new request. Otherwise
      // its delayed CANCEL_REPLY could stop the new observer after it starts.
      // This is a correctness-only wait (cancel-before-send), not a delay.
      await this.#cancelPending;
      if (epoch !== this.#retryEpoch || this.#settings.paused) return false;

      // The background validates existence/host at send time, not the active
      // browser window. Focus changes cannot silently retarget a prompt.
      let target;
      try {
        target = await chrome.runtime.sendMessage(createMessage(MessageType.GET_ACTIVE_TAB));
      } catch {
        target = null;
      }
      if (epoch !== this.#retryEpoch || this.#settings.paused) return false;
      if (
        !target?.supported ||
        target.tabId !== tabId ||
        target.platform !== platformId ||
        this.#connection.tabId !== tabId
      ) {
        this.#cancelReply();
        this.#pin = null;
        this.#setConnection(null);
        this.#phase = Phase.ERROR;
        this.#message = this.#t("connections.pinLost");
        this.#showCopyPrompt(prompt);
        this.#renderTabs();
        return false;
      }

      requestId = ++this.#requestCounter;
      this.#expectedReplyId = requestId;
      this.#lastPrompt = prompt;
      this.#latency.begin(); // stage: queued
      this.#phase = Phase.SENDING;
      this.#delivery = null;
      this.#clearWaitingReminder();
      this.#message =
        retry > 0
          ? this.#t("status.retryReason", { attempt: retry, reason: reasonText })
          : this.#t("status.sending", { platform: this.#connection.label });
      this.#render();

      await this.#ensureContentScript(tabId, target.url, platformId);
      if (epoch !== this.#retryEpoch || this.#settings.paused || this.#connection.tabId !== tabId) return false;
      this.#latency.mark("dispatched");
      const raw = await chrome.tabs.sendMessage(
        tabId,
        createMessage(MessageType.SEND_CHESS_PROMPT, {
          prompt,
          expected,
          requestId,
          rejectedMoves: this.#session.rejectedMoves,
        }),
      );
      this.#latency.mergeExternal(raw?.diagnostics?.stages);
      // ---- Late-response guards -------------------------------------------
      // Every response (success, failure, unconfirmed) must prove it still
      // belongs to the LIVE request before touching the UI:
      // - epoch changed  → pause/unpin/new game/undo/side switch cancelled it;
      // - request id gone → a reply already resolved (or finished) this request;
      // - game over      → a terminal result outranks any transport message.
      if (epoch !== this.#retryEpoch) {
        this.#delivery = { state: DeliveryState.STALE };
        return false;
      }
      if (this.#expectedReplyId !== requestId || this.#session.isGameOver) {
        // A fast AI reply (possibly a checkmate) or a terminal human result
        // won the race. A late acknowledgement/failure must not overwrite it
        // and must not trigger any new prompt.
        if (this.#delivery?.state !== DeliveryState.ANSWERED) this.#delivery = { state: DeliveryState.STALE };
        return true;
      }
      const response = normaliseResponse(raw);
      if (raw?.result === "submit-unconfirmed") {
        // ONE submit event fired; the host did not confirm it. Keep the
        // request pending (the content watcher still owns the reply), tell the
        // user to CHECK the chat, and offer Copy only as a deliberate,
        // secondary recovery — never "send it manually" as if nothing went.
        if (raw?.diagnostics) {
          this.#diagnostics = raw.diagnostics;
          this.#renderDiagnostics();
        }
        this.#markUnconfirmedSend(requestId);
        return false;
      }
      if (!response.ok || this.#settings.paused) {
        if (this.#expectedReplyId === requestId) this.#expectedReplyId = null;
        this.#phase = Phase.ERROR;
        const errorKeys = {
          "input-missing": "status.composerMissing",
          "type-failed": "status.typeFailed",
          "verify-failed": "status.verifyFailed",
          "submit-failed": "status.submitFailed",
          "generation-timeout": "status.generationTimeout",
        };
        this.#message = this.#settings.paused
          ? this.#t("status.paused")
          : this.#t(errorKeys[raw?.result] || "status.sendFailure", { detail: response.error });
        this.#delivery = { state: DeliveryState.NEVER, reason: raw?.result || "runtime" };
        this.#diagnostics = raw?.diagnostics || null;
        this.#renderDiagnostics();
        if (raw?.result === "generation-timeout") {
          let copied = Boolean(raw.copied);
          if (!copied) {
            try {
              await navigator.clipboard.writeText(prompt);
              copied = true;
            } catch {
              /* Copy button remains. */
            }
          }
          if (epoch !== this.#retryEpoch) return false;
          if (copied) this.#message = this.#t("status.timeoutCopied");
        }
        this.#showCopyPrompt(prompt);
        return false;
      }
      // A fast AI reply can arrive before send acknowledgement; do not restore
      // AWAITING on top of its accepted reply or the next serialized request.
      if (this.#expectedReplyId !== requestId) return true;
      this.#phase = Phase.AWAITING;
      this.#delivery = { state: DeliveryState.CONFIRMED, requestId };
      this.#scheduleWaitingReminder();
      if (raw?.manual) {
        this.#message = raw.copied ? this.#t("status.manualCopied") : this.#t("status.manualSend");
        this.#showCopyPrompt(prompt);
      } else {
        this.#message = "";
        this.#hideCopyPrompt();
      }
      this.#diagnostics = raw?.diagnostics || this.#diagnostics;
      this.#renderDiagnostics();
      return true;
    } catch (error) {
      if (epoch !== this.#retryEpoch) {
        this.#delivery = { state: DeliveryState.STALE };
        return false;
      }
      if (this.#expectedReplyId !== requestId || this.#session.isGameOver) {
        if (this.#delivery?.state !== DeliveryState.ANSWERED) this.#delivery = { state: DeliveryState.STALE };
        return true;
      }
      if (requestId !== null) this.#expectedReplyId = null;
      const detail = describeRuntimeError(error) || String(error);
      this.#phase = Phase.ERROR;
      this.#message = this.#t("status.couldNotReach", { detail });
      this.#delivery = { state: DeliveryState.NEVER, reason: "runtime" };
      if (detail.toLowerCase().includes("receiving end") || detail.toLowerCase().includes("could not establish")) {
        this.#message = this.#t("status.contentMissing");
        this.#showReloadTab();
      }
      this.#showCopyPrompt(prompt);
      return false;
    } finally {
      if (!match && epoch === this.#retryEpoch) this.#busy = false;
      this.#render();
    }
  }

  /** Applies the "attempted but unconfirmed" state without clearing the request. */
  #markUnconfirmedSend(requestId) {
    if (this.#expectedReplyId !== requestId || this.#session.isGameOver) return;
    // The matching user echo may have confirmed the send while the response
    // was in transit — never downgrade AWAITING back to unconfirmed.
    if (this.#phase === Phase.AWAITING) return;
    this.#phase = Phase.UNCONFIRMED;
    this.#message = this.#t("status.submitUnconfirmed");
    this.#delivery = { state: DeliveryState.UNCONFIRMED, requestId };
    this.#showCopyPrompt(this.#lastPrompt); // deliberate recovery, after "check the chat"
    this.#render();
  }

  #scheduleWaitingReminder() {
    this.#clearWaitingReminder();
    const ms = this.#settings.waitingReminderMs;
    if (!ms) return;
    // Bare setTimeout so tests can drive it with mock timers; in the browser
    // this is the same function. The callback re-checks every precondition —
    // it can never resend, fabricate a result, or speak over a finished game.
    this.#waitingReminderTimer = setTimeout(() => {
      this.#waitingReminderTimer = 0;
      if (
        this.#phase === Phase.AWAITING &&
        this.#expectedReplyId !== null &&
        !this.#session.isGameOver &&
        !this.#settings.paused
      ) {
        this.#message = this.#t("status.stillWaiting", { platform: this.#connection.label || "the AI" });
        this.#render();
      }
    }, ms);
  }

  #clearWaitingReminder() {
    clearTimeout(this.#waitingReminderTimer);
    this.#waitingReminderTimer = 0;
  }

  /** End the single expected reply without unloading its content script. */
  #cancelReply() {
    this.#expectedReplyId = null;
    this.#retryEpoch += 1;
    this.#retryToken += 1;
    this.#retryPending = false;
    this.#busy = false;
    this.#clearWaitingReminder();
    const tabId = this.#connection.tabId;
    if (Number.isInteger(tabId)) {
      this.#cancelPending = this.#cancelPending
        .then(() => chrome.tabs.sendMessage(tabId, createMessage(MessageType.CANCEL_REPLY)))
        .catch(() => undefined);
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
   * Wait for the actual bridge to acknowledge this page before sending. The
   * registered bootstrap uses a dynamic import, so executeScript can finish
   * before its message listener exists. A missing/stale PING is never proof
   * that it is safe to submit a prompt to the tab.
   *
   * @param {number} tabId
   * @param {string} url URL validated by the pin resolver just before sending
   * @param {string} platformId
   * @returns {Promise<void>}
   */
  async #ensureContentScript(tabId, url, platformId) {
    const ping = async () => {
      try {
        return await chrome.tabs.sendMessage(tabId, createMessage(MessageType.PING));
      } catch {
        return null;
      }
    };
    const accept = (pong) => {
      if (pong?.ok && pong.url && pong.url !== url) {
        throw new Error("The pinned tab navigated before its chess prompt could be sent.");
      }
      if (pong?.ok && pong.paused) throw new Error("The content script is paused.");
      if (pong?.ok && pong.url === url && pong.platform === platformId) {
        if (pong.diagnostics) {
          this.#diagnostics = pong.diagnostics;
          this.#renderDiagnostics();
        }
        return true;
      }
      return false;
    };

    if (accept(await ping())) return;
    log.debug("content script missing or outdated, injecting");
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    } catch (error) {
      log.warn("could not inject the content script", describeRuntimeError(error));
      throw error;
    }
    // Only the PING is retried, never SEND_CHESS_PROMPT. This accommodates a
    // cold dynamic import without risking a double submission.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (accept(await ping())) return;
      if (attempt < 19) await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error("The content script did not acknowledge the pinned tab.");
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
      supported: Boolean(description?.supported && platform && Number.isInteger(description?.tabId)),
      platform: platform?.id || "",
      label: platform?.name || "",
      title: typeof description?.title === "string" ? description.title : "",
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
    controls.switchSide?.addEventListener(
      "click",
      () => void this.switchSide(this.#settings.playerColor === "w" ? "b" : "w"),
    );
    controls.pause?.addEventListener("click", () => void this.updateSettings({ paused: !this.#settings.paused }));
    controls.askAi.addEventListener("click", () => void this.requestAiMove());
    controls.copyPgn.addEventListener("click", () => void this.#copyPgn());

    // ---- AI battle (unrated) ----
    const battleRefs = this.#refs.battle;
    battleRefs?.start?.addEventListener("click", () => {
      const opponentTabId = Number(battleRefs.opponentTab?.value || 0);
      const opponentColor = battleRefs.opponentColor?.value === "w" ? "w" : "b";
      const minutesPerSide = Number(battleRefs.minutes?.value || this.#settings.battleMinutesPerSide);
      const incrementSec = Number(battleRefs.increment?.value ?? this.#settings.battleIncrementSec);
      void this.startBattle({ opponentTabId, opponentColor, minutesPerSide, incrementSec }).then(() =>
        this.#renderBattle(),
      );
    });
    battleRefs?.pause?.addEventListener("click", () => this.pauseBattle());
    battleRefs?.resume?.addEventListener("click", () => this.resumeBattle());
    battleRefs?.askAgain?.addEventListener("click", () => this.askBattleAgain());
    battleRefs?.abort?.addEventListener("click", () => this.abortBattle());
    battleRefs?.rematch?.addEventListener("click", () => void this.startRematch());
    battleRefs?.export?.addEventListener("click", () => {
      const out = this.exportBattlePaired();
      if (out) this.#downloadText(out.text, out.filename);
    });
    battleRefs?.exportAll?.addEventListener("click", () => {
      const out = this.exportBattlesAll();
      if (out) this.#downloadText(out.text, out.filename);
      else {
        this.#message = this.#t("battle.empty");
        this.#render();
      }
    });

    // ---- Prompt Studio (progressive disclosure; zero network) ----
    const studioRefs = this.#refs.studio;
    studioRefs?.root?.addEventListener("toggle", () => this.#renderStudio());
    studioRefs?.style?.addEventListener("change", () => this.#renderStudio());
    studioRefs?.funSentences?.addEventListener("input", () => this.#renderStudio());
    studioRefs?.copy?.addEventListener("click", () => {
      const preview = this.studioPreview(this.#studioOverrides());
      void this.#copyText(preview.text, this.#t("studio.copied"));
    });

    // ---- Latency timeline copy (redacted: stage deltas only) ----
    this.#refs.diagnostics?.copyTimeline?.addEventListener("click", () => {
      void this.#copyText(formatLatencyReport(this.#latency.entries), this.#t("timeline.copied"));
    });
    controls.openPgn.addEventListener("click", () => this.#openPgnDialog());
    controls.copyFen.addEventListener(
      "click",
      () => void this.#copyText(this.#session.fen, this.#t ? this.#t("status.fenCopied") : "FEN copied."),
    );
    controls.statusAction.addEventListener("click", () => void this.#runStatusAction());
    document.getElementById("pin-change")?.addEventListener("click", () => {
      // The chip's explicit Change action: open the full picker (fresh list).
      void this.refreshConnection().then(() => {
        if (platformBanner.root) platformBanner.root.open = true;
        platformBanner.list?.querySelector?.("button")?.focus?.();
      });
    });
    platformBanner.refresh?.addEventListener("click", () => void this.refreshConnection());
    platformBanner.unpin?.addEventListener("click", () => void this.unpinTab());
    platformBanner.list?.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-tab-id]");
      const tabId = Number(button?.dataset?.tabId);
      if (Number.isInteger(tabId) && button) void this.pinTab(tabId);
    });
    if (this.#refs.match) {
      const match = this.#refs.match;
      match.anchor?.addEventListener("change", (event) => {
        if (!this.#engineRange) return;
        void this.updateSettings({ matchAnchorElo: clampUciElo(event.target.value, this.#engineRange) });
      });
      match.movetime?.addEventListener("change", (event) => {
        void this.updateSettings({ matchMoveTimeMs: clampMoveTime(event.target.value) });
      });
      match.start?.addEventListener("click", () => void this.startRatedMatch());
      match.stop?.addEventListener("click", () => this.stopRatedMatch());
      match.export?.addEventListener("click", () => void this.exportRatedMatches());
    }

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
      void this.switchSide(value === "b" ? "b" : "w");
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
      });
    }
    if (this.#refs.analysis?.level) {
      this.#refs.analysis.level.addEventListener("change", (event) => {
        void this.updateSettings({ engineLevel: Number(event.target.value) });
      });
    }
    const numberSetting = (element, key, convert = Number) =>
      element?.addEventListener("change", (event) => {
        void this.updateSettings({ [key]: convert(event.target.value) });
      });
    numberSetting(settingsDialog.controls.maxRetries, "maxRetries");
    numberSetting(settingsDialog.controls.funSentences, "funCommentarySentences");
    numberSetting(settingsDialog.controls.soundVolume, "soundVolume");
    numberSetting(settingsDialog.controls.clockDuration, "clockDurationMs", (minutes) => Number(minutes) * 60000);
    numberSetting(settingsDialog.controls.generationWait, "generationWaitMs", (seconds) => Number(seconds) * 1000);
    settingsDialog.controls.sendMode?.addEventListener("change", (event) => {
      void this.updateSettings({ sendMode: event.target.value });
    });
    const enumSetting = (element, key) =>
      element?.addEventListener("change", (event) => {
        void this.updateSettings({ [key]: event.target.value });
      });
    enumSetting(settingsDialog.controls.interfaceDetail, "interfaceDetail");
    enumSetting(settingsDialog.controls.boardOrientation, "boardOrientation");
    enumSetting(settingsDialog.controls.moveListFormat, "moveListFormat");
    enumSetting(settingsDialog.controls.moveInteraction, "moveInteraction");
    enumSetting(settingsDialog.controls.promptStyle, "promptStyle");
    numberSetting(settingsDialog.controls.waitingReminder, "waitingReminderMs");

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

    chrome.runtime.onMessage.addListener((message, sender) => {
      if (message?.type === MessageType.PIN_CHANGED) {
        if (!message.pin) {
          // The old tab has gone; never follow the newly focused chat.
          if (this.#match) this.#abortMatch(this.#t("match.pinLost"));
          this.#cancelReply();
          this.#pin = null;
          this.#setConnection(null);
          this.#phase = Phase.ERROR;
          this.#message = this.#t(message.reason === "unpin" ? "connections.unpinned" : "connections.pinLost");
          this.#render();
        }
        void this.refreshConnection();
        return;
      }
      if (message?.type === MessageType.ACTIVE_TAB_CHANGED) return; // focus never changes a pin
      if (
        message?.type === MessageType.AI_MOVE ||
        (message?.type === MessageType.CONTENT_STATUS && message.state === "no-move")
      ) {
        // Battle replies are routed strictly per side (tab + requestId) inside;
        // no-move verdicts arrive as CONTENT_STATUS and map to AI_NO_MOVE.
        const battlePayload =
          message.type === MessageType.CONTENT_STATUS
            ? { ...message, type: MessageType.AI_NO_MOVE, move: null }
            : message;
        if (this.#handleBattleReply(battlePayload, sender)) return;
      }
      if (message?.type !== MessageType.AI_MOVE && message?.type !== MessageType.CONTENT_STATUS) return;
      if (
        !this.#pin ||
        sender?.tab?.id !== this.#pin.tabId ||
        message.requestId !== this.#expectedReplyId ||
        this.#expectedReplyId === null ||
        (this.#phase !== Phase.AWAITING && this.#phase !== Phase.SENDING && this.#phase !== Phase.UNCONFIRMED)
      ) {
        // A dropped CONTENT_STATUS error is worth surfacing as "stale" while
        // the game is still live; a finished board simply ignores it.
        if (message?.type === MessageType.CONTENT_STATUS && message.error && !this.#session.isGameOver) {
          this.#delivery = { state: DeliveryState.STALE };
        }
        return;
      }
      if (message.diagnostics) {
        this.#diagnostics = message.diagnostics;
        this.#latency.mergeExternal(message.diagnostics.stages);
        this.#renderDiagnostics();
      }
      if (message.type === MessageType.AI_MOVE) {
        if (this.#session.isGameOver) return; // terminal results are never re-opened
        void this.handleAiMove(message);
        return;
      }
      // A finished game never accepts further CONTENT_STATUS updates.
      if (this.#session.isGameOver) return;
      if (message.state === "generation-wait") {
        this.#message = this.#t("status.waitGeneration", { platform: this.#connection.label });
        this.#render();
      } else if (message.state === "submit-unconfirmed") {
        this.#markUnconfirmedSend(message.requestId);
      } else if (message.state === "prompt-echoed" || message.state === "prompt-sent") {
        // The host confirmed delivery (fresh echo / acknowledgement). Move
        // unconfirmed → awaiting without issuing any new submit.
        if (this.#expectedReplyId === message.requestId && this.#phase !== Phase.AWAITING) {
          this.#phase = Phase.AWAITING;
          this.#message = "";
          this.#delivery = { state: DeliveryState.CONFIRMED, requestId: message.requestId };
          this.#hideCopyPrompt();
          this.#scheduleWaitingReminder();
          this.#render();
        }
      } else if (message.state === "no-move") {
        void this.handleAiMove({ noMove: true, repeated: message.repeated, text: message.text });
      } else if (message.error && this.#phase !== Phase.UNCONFIRMED) {
        this.#phase = Phase.ERROR;
        this.#message = this.#t("status.sendFailure", { detail: message.error });
        this.#delivery = { state: DeliveryState.NEVER, reason: "content" };
        this.#showCopyPrompt(this.#lastPrompt);
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
    if (this.#match) return;
    const { fenDialog } = this.#refs;
    if (
      this.#settings.confirmDestructive &&
      this.#session.plyCount > 0 &&
      typeof globalThis.confirm === "function" &&
      !globalThis.confirm(this.#t("controls.confirmReplaceGame"))
    ) {
      fenDialog?.root?.close?.();
      return;
    }
    this.#cancelReply();
    this.#matchFinished = false;
    this.#localEngineMode = false;
    this.#lastIllegalReply = null;
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
    this.#message = this.#t("status.positionSet");
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
      const manualAwaiting =
        this.#settings.sendMode === "manual" && this.#expectedReplyId !== null && text === this.#lastPrompt;
      this.#message = manualAwaiting ? this.#t("status.manualCopied") : confirmation;
      this.#phase = manualAwaiting ? Phase.AWAITING : Phase.IDLE;
      if (!manualAwaiting) this.#hideCopyPrompt();
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
      toggleBtn.textContent = this.#t("diagnostics.showDetails");
    } else {
      reportEl.textContent = this.#diagnostics ? formatReport(this.#diagnostics) : "No diagnostics yet.";
      toggleBtn.textContent = this.#t("diagnostics.hideDetails");
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
      case StatusAction.CHECK_CHAT:
        await this.#focusPinnedTab();
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

  /** Focuses the pinned chat so the user can CHECK it before any resend. */
  async #focusPinnedTab() {
    const tabId = this.#pin?.tabId ?? this.#connection.tabId;
    if (!Number.isInteger(tabId)) {
      if (this.#refs.platformBanner.root) this.#refs.platformBanner.root.open = true;
      return;
    }
    try {
      await chrome.tabs.update?.(tabId, { active: true });
    } catch (error) {
      log.debug("could not focus the pinned tab", describeRuntimeError(error));
      if (this.#refs.platformBanner.root) this.#refs.platformBanner.root.open = true;
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
    if (this.#flipOverride !== null) return this.#flipOverride;
    switch (this.#settings.boardOrientation) {
      case "white":
        return false;
      case "black":
        return true;
      default:
        return this.#session.playerColor === "b";
    }
  }

  /** @returns {ReturnType<typeof describeStatus>} */
  #status() {
    // Terminal results outrank everything, including pause and late errors:
    // a finished game must always read as finished.
    if (this.#session.isGameOver) {
      if (this.#matchFinished) return { text: this.#message, kind: "info", action: StatusAction.NEW_GAME };
      return describeStatus({
        session: this.#session,
        connection: this.#connection,
        phase: Phase.IDLE,
        message: "",
        t: this.#t,
      });
    }
    if (this.#settings.paused) return { text: this.#t("status.paused"), kind: "info", action: StatusAction.NONE };
    if (this.#lastIllegalReply && this.#phase === Phase.ERROR) {
      return { text: this.#message, kind: "error", action: StatusAction.RETRY };
    }
    if (this.#matchFinished) return { text: this.#message, kind: "info", action: StatusAction.NEW_GAME };
    if (this.#phase === Phase.UNCONFIRMED && this.#expectedReplyId !== null) {
      // One attempt fired, delivery uncertain: CHECK first, Copy only second.
      // No Ask-again — the request is still live and may yet be answered.
      return {
        text: this.#message || this.#t("status.submitUnconfirmed"),
        kind: "error",
        action: StatusAction.CHECK_CHAT,
      };
    }
    if (this.#phase === Phase.AWAITING && this.#expectedReplyId !== null) {
      if (this.#settings.sendMode === "manual") {
        return {
          text: this.#message || this.#t("status.manualSend"),
          kind: "waiting",
          action: StatusAction.COPY_PROMPT,
        };
      }
      // A still-pending response is not permission to submit the same prompt
      // again. Ask again becomes available after a reported failure/rejection.
      return {
        text: this.#message || this.#t("status.waitingAi", { platform: this.#connection.label }),
        kind: "waiting",
        action: StatusAction.NONE,
      };
    }
    return describeStatus({
      session: this.#session,
      connection: this.#connection,
      phase: this.#phase,
      message: this.#message,
      busy: this.#phase === Phase.SENDING || (this.#busy && !this.#match),
      t: this.#t,
      diagnosticsError: this.#diagnostics?.lastError || "",
    });
  }

  /** Schedules a debounced snapshot write. */
  #persist() {
    window.clearTimeout(this.#persistTimer);
    const rated = Boolean(this.#match || this.#matchSaving);
    this.#persistTimer = window.setTimeout(async () => {
      if (!this.#settings.persistGame || !globalThis.chrome?.storage?.local) {
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
        if (this.#library && this.#session.plyCount > 0 && !rated) {
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

  /** Battle section: truthful state, clocks, recovery actions, W-D-L history. */
  #renderBattle() {
    const battle = this.#refs.battle;
    if (!battle?.root) return;
    const bt = this.#battleState;
    const running = Boolean(bt && !bt.finished && !bt.paused);
    const paused = Boolean(bt && !bt.finished && bt.paused);
    if (battle.status) {
      if (!bt) battle.status.textContent = "";
      else if (bt.finished) {
        battle.status.textContent = this.#t("battle.finished", {
          result: bt.battle.result?.token ?? "*",
          reason: bt.battle.result?.reason ?? "",
        });
      } else if (paused) battle.status.textContent = bt.pauseReason;
      else {
        const sides = bt.battle.sides;
        battle.status.textContent = `${sides.w.label} ${formatClock(battleRemainingMs(bt.battle.clock, "w"))} — ${sides.b.label} ${formatClock(battleRemainingMs(bt.battle.clock, "b"))}`;
      }
    }
    if (battle.start) battle.start.disabled = Boolean(bt && !bt.finished);
    if (battle.pause) battle.pause.disabled = !running;
    if (battle.resume) battle.resume.disabled = !paused;
    if (battle.askAgain) battle.askAgain.disabled = !paused;
    if (battle.abort) battle.abort.disabled = !bt || bt.finished;
    if (battle.rematch) battle.rematch.disabled = !bt;
    if (battle.export) battle.export.disabled = !bt;
    if (battle.exportAll) battle.exportAll.disabled = Object.keys(this.#battleLedger).length === 0;
    this.#renderBattleHistory();
  }

  #renderBattleHistory() {
    const battle = this.#refs.battle;
    if (!battle?.root) return;
    const pairs = Object.entries(this.#battleLedger);
    if (battle.ledger) {
      battle.ledger.textContent =
        pairs
          .map(([, pair]) =>
            this.#t("battle.wdl", {
              white: pair.sides.w.label,
              black: pair.sides.b.label,
              w: pair.whiteWins,
              d: pair.draws,
              l: pair.blackWins,
            }),
          )
          .join("\n") || this.#t("battle.empty");
    }
    if (battle.history) {
      const rows = [];
      for (const [, pair] of pairs) {
        for (const item of pair.history ?? []) {
          rows.push(`${item.date.slice(0, 10)} · ${item.result.token} (${item.result.reason})`);
        }
      }
      battle.history.textContent = rows.join("\n");
    }
  }

  /** Latency timeline (Diagnostics): stage deltas only — never content. */
  #renderTimeline() {
    const refs = this.#refs.diagnostics;
    if (!refs?.timeline) return;
    const entries = this.#latency.entries;
    const rows = entries.map((entry, index) =>
      this.#t("timeline.moveLabel", { n: index + 1, total: Math.round(entry.totalMs) }),
    );
    refs.timeline.textContent = rows.join("\n") || this.#t("timeline.empty");
  }

  #studioOverrides() {
    const studio = this.#refs.studio;
    const style = studio?.style?.value || this.#settings.promptStyle;
    const funSentences = Number(studio?.funSentences?.value || this.#settings.funCommentarySentences);
    const bt = this.#battleState;
    const battleClock =
      bt && !bt.finished
        ? {
            remainingMs: battleRemainingMs(bt.battle.clock, this.#session.turn),
            incrementSec: bt.battle.incrementSec,
          }
        : null;
    return { style, funSentences, battleClock };
  }

  /** Prompt Studio: rendered only when the section is opened (progressive disclosure). */
  #renderStudio() {
    const studio = this.#refs.studio;
    if (!studio?.root || studio.root.open === false) return;
    const overrides = this.#studioOverrides();
    if (studio.funRow) studio.funRow.hidden = overrides.style !== "fun";
    const preview = this.studioPreview(overrides);
    if (studio.platform) {
      studio.platform.textContent = this.#t("studio.platform", { label: preview.platformLabel || "—" });
    }
    if (studio.metrics) studio.metrics.textContent = this.#t("studio.metrics", preview.metrics);
    if (studio.budgetHint) studio.budgetHint.hidden = !preview.metrics.overBudget;
    if (studio.preview) studio.preview.textContent = preview.text;
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
        showLastMove: this.#settings.highlightLastMove,
      }),
      {
        selected: this.#selected,
        interactive:
          !this.#busy && !this.#settings.paused && !this.#matchFinished && session.isPlayerTurn && !session.isGameOver,
        hint: this.#hintMove,
        animationsEnabled: this.#settings.animationsEnabled,
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
      statusAction.textContent = ACTION_KEYS[status.action] ? this.#t(ACTION_KEYS[status.action]) : "";
      statusAction.dataset.action = status.action;
      statusAction.disabled = this.#retryPending || Boolean(this.#match) || this.#settings.paused;
    }

    if (turn) {
      turn.textContent = session.isGameOver
        ? this.#t("status.gameOver")
        : this.#t("status.turn", { color: this.#t(session.turn === "w" ? "clock.white" : "clock.black") });
    }
    if (opponent) {
      opponent.textContent = this.#connection.supported
        ? `${this.#connection.label}${this.#connection.title ? ` — ${this.#connection.title}` : ` #${this.#connection.tabId}`} (${this.#t(session.aiColor === "w" ? "clock.white" : "clock.black")})`
        : this.#t("connections.choosePin");
    }
    if (fen) {
      fen.textContent = session.fen;
    }

    if (controls.undo) controls.undo.disabled = session.plyCount === 0 || this.#busy || this.#settings.paused;
    if (controls.newGame) controls.newGame.disabled = this.#busy;
    if (controls.flip) controls.flip.disabled = this.#busy;
    if (controls.switchSide) {
      controls.switchSide.textContent = this.#t(
        session.playerColor === "w" ? "controls.playBlack" : "controls.playWhite",
      );
      controls.switchSide.disabled = this.#busy;
    }
    if (controls.pause) {
      controls.pause.textContent = this.#t(this.#settings.paused ? "controls.resume" : "controls.pause");
      controls.pause.setAttribute("aria-pressed", String(this.#settings.paused));
    }
    if (controls.askAi) {
      controls.askAi.hidden = !(
        session.isWaitingForAi &&
        !session.isGameOver &&
        !this.#match &&
        !this.#matchFinished &&
        !this.#localEngineMode &&
        this.#expectedReplyId === null
      );
      controls.askAi.disabled =
        this.#phase === Phase.SENDING || this.#busy || this.#retryPending || this.#settings.paused;
      controls.askAi.textContent = this.#t(
        this.#lastIllegalReply && this.#phase === Phase.ERROR ? "status.askAgain" : "status.askAi",
      );
    }
    if (controls.hint) {
      controls.hint.disabled = this.#busy || this.#settings.paused || session.isGameOver;
    }

    // Replay controls
    if (controls.replayStart) controls.replayStart.disabled = !session.canGoBack;
    if (controls.replayBack) controls.replayBack.disabled = !session.canGoBack;
    if (controls.replayForward) controls.replayForward.disabled = !session.canGoForward;
    if (controls.replayEnd) controls.replayEnd.disabled = !session.canGoForward;

    this.#renderEval();
    this.#renderClock();
    this.#renderDiagnostics();
    this.#renderMatch();
    this.#renderBattle();
    this.#renderTimeline();

    // FEN status
    if (this.#refs.fenStatus) {
      this.#refs.fenStatus.textContent = "";
    }
  }

  /**
   * Updates the Play-first view extras: pinned-chat chip, side line, compact
   * move preview, rated banner and the "What happened?" disclosure. All
   * elements are optional so the Node harness (and older fixtures) work.
   */
  #renderPlayMeta() {
    const t = this.#t;
    const session = this.#session;
    const chip = this.#el("pin-chip");
    const chipText = this.#el("pin-chip-text");
    if (chip && chipText) {
      chipText.textContent = this.#pin
        ? t("chip.pinned", {
            platform: this.#connection.label,
            title: this.#pin.title || `#${this.#pin.tabId}`,
          })
        : t("chip.none");
      chip.classList.toggle("is-pinned", Boolean(this.#pin));
      chip.classList.toggle("is-empty", !this.#pin);
    }
    const sideLine = this.#el("side-line");
    if (sideLine) {
      const colorName = t(session.playerColor === "w" ? "clock.white" : "clock.black");
      sideLine.textContent = t("play.youPlay", { color: colorName });
    }
    const preview = this.#el("moves-preview");
    if (preview) {
      if (session.plyCount === 0) {
        preview.textContent = t("moves.empty");
        preview.classList.add("is-empty");
      } else {
        preview.classList.remove("is-empty");
        const raw =
          this.#settings.moveListFormat === "uci"
            ? session.history.map((entry) => entry.uci).join(" ")
            : session.moveListText;
        preview.textContent = raw.length > 96 ? `… ${raw.slice(-95)}` : raw;
      }
    }
    const rated = this.#el("rated-banner");
    if (rated) {
      rated.hidden = !this.#match;
      if (this.#match) {
        rated.textContent = t("match.banner", {
          chatColor: t(this.#match.aiColor === "w" ? "clock.white" : "clock.black"),
          engineColor: t(this.#match.engineColor === "w" ? "clock.white" : "clock.black"),
          anchor: this.#match.anchor,
        });
      }
    }
    const what = this.#el("what-happened");
    const whatDetail = this.#el("what-happened-detail");
    if (what) what.hidden = !this.#delivery;
    if (whatDetail) whatDetail.textContent = describeDelivery(this.#delivery, t);
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
    evalText.textContent = this.#t("analysis.evalHeuristic", { score: formatted.text });

    // Convert score to 0-100% for white
    const clamped = Math.max(-1000, Math.min(1000, score));
    const percent = 50 + (clamped / 2000) * 50;
    evalFill.style.width = `${percent}%`;
  }

  /** @returns {number} first move number, taken from the starting FEN. */
  #historyStartNumber() {
    return Number.parseInt(this.#session.initialFen.split(/\s+/)[5] || "1", 10) || 1;
  }

  /** @returns {'w'|'b'} colour of the first ply in the history. */
  #historyFirstMover() {
    return this.#session.initialFen.split(/\s+/)[1] === "b" ? "b" : "w";
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
    if (this.#refs.analysis?.level) this.#refs.analysis.level.value = String(this.#engineLevel);
    if (settingsDialog.controls.sendMode) settingsDialog.controls.sendMode.value = this.#settings.sendMode;
    if (settingsDialog.controls.promptStyle) settingsDialog.controls.promptStyle.value = this.#settings.promptStyle;
    if (settingsDialog.controls.funSentences)
      settingsDialog.controls.funSentences.value = String(this.#settings.funCommentarySentences);
    if (settingsDialog.controls.maxRetries)
      settingsDialog.controls.maxRetries.value = String(this.#settings.maxRetries);
    if (settingsDialog.controls.generationWait)
      settingsDialog.controls.generationWait.value = String(this.#settings.generationWaitMs / 1000);
    if (settingsDialog.controls.soundVolume)
      settingsDialog.controls.soundVolume.value = String(this.#settings.soundVolume);
    if (settingsDialog.controls.clockDuration)
      settingsDialog.controls.clockDuration.value = String(this.#settings.clockDurationMs / 60000);

    document.body.dataset.theme = resolveTheme(this.#settings.theme);
    document.body.dataset.boardTheme = this.#settings.boardTheme;
    document.body.dataset.fontScale = this.#settings.fontScale;
    document.body.dataset.density = this.#settings.density;
    document.body.dataset.interface = this.#settings.interfaceDetail;

    const newControls = settingsDialog.controls;
    if (newControls.interfaceDetail) newControls.interfaceDetail.value = this.#settings.interfaceDetail;
    if (newControls.boardOrientation) newControls.boardOrientation.value = this.#settings.boardOrientation;
    if (newControls.moveListFormat) newControls.moveListFormat.value = this.#settings.moveListFormat;
    if (newControls.moveInteraction) newControls.moveInteraction.value = this.#settings.moveInteraction;
    if (newControls.waitingReminder) newControls.waitingReminder.value = String(this.#settings.waitingReminderMs);

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
      meta.textContent = `${game.date} • ${game.result} • ${this.#t("library.moves", { count: game.moves.length })} • ${this.#t(game.playerColor === "w" ? "clock.white" : "clock.black")}`;
      item.append(meta);

      const actions = document.createElement("div");
      actions.className = "library-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "button";
      openBtn.textContent = this.#t("library.open");
      openBtn.dataset.action = "open";
      openBtn.dataset.id = game.id;
      actions.append(openBtn);

      const renameBtn = document.createElement("button");
      renameBtn.className = "button";
      renameBtn.textContent = this.#t("library.rename");
      renameBtn.dataset.action = "rename";
      renameBtn.dataset.id = game.id;
      actions.append(renameBtn);

      const dupBtn = document.createElement("button");
      dupBtn.className = "button";
      dupBtn.textContent = this.#t("library.duplicate");
      dupBtn.dataset.action = "duplicate";
      dupBtn.dataset.id = game.id;
      actions.append(dupBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "button";
      delBtn.textContent = this.#t("library.delete");
      delBtn.dataset.action = "delete";
      delBtn.dataset.id = game.id;
      actions.append(delBtn);

      const expBtn = document.createElement("button");
      expBtn.className = "button";
      expBtn.textContent = this.#t("library.export");
      expBtn.dataset.action = "export";
      expBtn.dataset.id = game.id;
      actions.append(expBtn);

      item.append(actions);
      fragment.append(item);
    }

    lib.list.replaceChildren(fragment);
  }

  async openLibraryGame(id) {
    if (!this.#library || this.#match) return;
    const game = this.#library.games.find((g) => g.id === id);
    if (!game) return;
    if (
      this.#settings.confirmDestructive &&
      this.#session.plyCount > 0 &&
      typeof globalThis.confirm === "function" &&
      !globalThis.confirm(this.#t("controls.confirmReplaceGame"))
    ) {
      return;
    }
    this.#cancelReply();
    this.#matchFinished = false;
    this.#localEngineMode = false;
    this.#lastIllegalReply = null;

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
    this.#message = this.#t("status.gameRestored");
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
    if (this.#match || this.#busy) return;
    this.#cancelReply();
    let target = ply;
    if (target < 0) target = 0;
    if (target > this.#session.history.length) target = this.#session.history.length;
    const ok = this.#session.jumpToPly(target);
    if (ok) {
      this.#render();
      this.#announce(`Ply ${target}`);
    }
  }

  /** Side switching is a new game, never a color swap in an existing game. */
  async switchSide(color) {
    if (color === this.#settings.playerColor) return true;
    if (this.#busy || this.#match) {
      this.#applySettingsToDialog();
      return false;
    }
    if (
      this.#settings.confirmDestructive &&
      this.#session.plyCount > 0 &&
      typeof globalThis.confirm === "function" &&
      !globalThis.confirm(this.#t("controls.confirmSide"))
    ) {
      this.#applySettingsToDialog();
      return false;
    }
    await this.updateSettings({ playerColor: color });
    return true;
  }

  /**
   * Start a REAL game: Stockfish owns the session's opponent/human slot, and
   * the chat AI owns only its AI slot. The chat reply still passes the pinned
   * content watcher, strict send contract and GameSession legality checks.
   */
  async startRatedMatch() {
    if (this.#match || this.#matchSaving || this.#busy) return false;
    if (this.#settings.paused) {
      this.#message = this.#t("status.paused");
      this.#render();
      return false;
    }
    if (this.#settings.sendMode !== "auto") {
      this.#message = this.#t("match.requiresAuto");
      this.#phase = Phase.ERROR;
      this.#render();
      return false;
    }
    const target = await chrome.runtime.sendMessage(createMessage(MessageType.GET_ACTIVE_TAB)).catch(() => null);
    if (this.#match || this.#matchSaving || this.#busy || this.#settings.paused) return false;
    if (
      !target?.supported ||
      !this.#pin ||
      target.tabId !== this.#pin.tabId ||
      target.platform !== this.#connection.platform ||
      target.tabId !== this.#connection.tabId
    ) {
      this.#message = this.#t("match.requiresPin");
      this.#phase = Phase.ERROR;
      this.#render();
      return false;
    }
    if (!this.#stockfish?.ready || !this.#engineRange) {
      this.#message = this.#t("match.engineError", { detail: this.#engineError || this.#t("match.unavailable") });
      this.#phase = Phase.ERROR;
      this.#render();
      return false;
    }
    if (typeof globalThis.confirm === "function" && !globalThis.confirm(this.#t("match.confirmReplace"))) return false;
    this.#cancelReply();
    const aiColor = this.#matchBook.games.length % 2 === 0 ? "w" : "b";
    const engineColor = aiColor === "w" ? "b" : "w";
    const anchor = clampUciElo(this.#settings.matchAnchorElo, this.#engineRange);
    this.#session.reset({ playerColor: engineColor });
    this.#matchFinished = false;
    this.#localEngineMode = false;
    this.#flipOverride = null;
    this.#clearSelection();
    this.#hintMove = null;
    const match = {
      tabId: target.tabId,
      platformId: target.platform,
      aiColor,
      engineColor,
      anchor,
      moveTime: clampMoveTime(this.#settings.matchMoveTimeMs),
      stockfishMoves: 0,
      chatMoves: 0,
    };
    this.#match = match;
    this.#busy = true; // held until rated completion or an unrated abort
    this.#phase = Phase.IDLE;
    this.#message = this.#t("match.started", {
      color: this.#t(aiColor === "w" ? "clock.white" : "clock.black"),
      anchor,
    });
    this.#persist();
    this.#render();
    try {
      await this.#stockfish.newGame(anchor);
      if (this.#match !== match) return false;
      await this.#advanceMatch(match);
      return this.#match === match;
    } catch (error) {
      if (this.#match === match)
        this.#abortMatch(this.#t("match.engineError", { detail: error?.message || String(error) }));
      return false;
    }
  }

  async #advanceMatch(match = this.#match) {
    if (!match || this.#match !== match || this.#settings.paused) return;
    const session = this.#session;
    if (session.outcome.over) {
      await this.#finishMatch(session.outcome.result, session.outcome.reason);
      return;
    }
    if (session.turn === match.aiColor) {
      const prompt = buildTurnPrompt(this.#turnPromptContext());
      const sent = await this.#sendPrompt(prompt, { expected: "rated-ai-move", match: true });
      if (!sent && this.#match === match) this.#abortMatch(this.#t("match.unratedProtocol"));
      return;
    }

    this.#phase = Phase.IDLE;
    this.#message = this.#t("match.engineThinking", { anchor: match.anchor });
    this.#render();
    try {
      let legalUci = "";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const answer = await this.#stockfish.search(session.fen, match.anchor, match.moveTime);
        if (this.#match !== match || this.#settings.paused) return;
        const legal = session.position.moveFromUci(answer);
        if (legal && toUci(legal) === answer) {
          legalUci = answer;
          break;
        }
        log.warn(`Stockfish proposed illegal move ${answer}; research attempt ${attempt + 1}`);
      }
      if (!legalUci) throw new Error("Stockfish returned two illegal moves; game not rated.");
      const result = session.playHumanMove(legalUci); // engineColor slot ONLY
      if (!result.ok) throw new Error("Stockfish move rejected by the chess rules engine.");
      match.stockfishMoves += 1;
      this.#persist();
      this.#updateClockAfterMove(); // clock state is correctness-critical
      scheduleOffPath(() => {
        this.#updateBadge();
        this.#playSoundForMove(result.entry);
      });
      this.#render();
      if (session.outcome.over) await this.#finishMatch(session.outcome.result, session.outcome.reason);
      else await this.#advanceMatch();
    } catch (error) {
      if (this.#match === match)
        this.#abortMatch(this.#t("match.engineError", { detail: error?.message || String(error) }));
    }
  }

  async #finishMatch(result, reason) {
    const match = this.#match;
    if (!match || this.#matchSaving) return;
    const outcome = this.#session.outcome;
    const terminal = ["checkmate", "stalemate", "fifty-move", "threefold-repetition", "insufficient-material"];
    if (
      !((terminal.includes(reason) && outcome.over && result === outcome.result) || reason === "resignation") ||
      match.stockfishMoves === 0 ||
      match.chatMoves === 0
    ) {
      this.#abortMatch(this.#t("match.unratedProtocol"));
      return;
    }
    const pgn = formatPgn({
      initialFen: this.#session.initialFen,
      san: this.#session.history.map((entry) => entry.san),
      result,
      headers: {
        Event: "Stockfish UCI_Elo match",
        Site: "AI Chess Companion (local)",
        White: match.aiColor === "w" ? `Chat AI (${match.platformId})` : `Stockfish UCI_Elo ${match.anchor}`,
        Black: match.aiColor === "b" ? `Chat AI (${match.platformId})` : `Stockfish UCI_Elo ${match.anchor}`,
        Termination: reason,
      },
    });
    const record = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
      anchorElo: match.anchor,
      aiColor: match.aiColor,
      result,
      platformId: match.platformId,
      pgn,
      stockfishMoves: match.stockfishMoves,
      chatMoves: match.chatMoves,
    };
    // The chess result is already final. Hide Stop and serialize persistence
    // before another match can start; a late Stop/pause/reset must not turn a
    // completed game into a protocol loss or overwrite a newer board status.
    const finishedSession = this.#session;
    const finishedEpoch = this.#retryEpoch; // GameSession.reset mutates in place
    this.#match = null;
    this.#matchSaving = true;
    this.#busy = false;
    this.#expectedReplyId = null;
    this.#matchFinished = reason === "resignation";
    this.#phase = Phase.IDLE;
    this.#message = this.#t("match.saving");
    this.#render();
    let saved = null;
    try {
      saved = await appendRatedMatch(this.#matchBook, record);
    } catch (error) {
      log.warn("could not store rated match", error);
    }
    this.#matchSaving = false;
    if (saved) this.#matchBook = saved;
    if (this.#session === finishedSession && this.#retryEpoch === finishedEpoch) {
      this.#phase = saved ? Phase.IDLE : Phase.ERROR;
      this.#message = saved ? this.#t("match.finished", { result }) : this.#t("match.storageError");
      this.#render();
    } else {
      this.#renderMatch(); // reset/new board: don't replace its status with an old result
    }
  }

  #abortMatch(reason) {
    if (!this.#match) return;
    this.#match = null;
    this.#cancelReply();
    this.#stopStockfish();
    this.#busy = false;
    this.#phase = Phase.ERROR;
    this.#message = reason;
    this.#render();
    if (!this.#settings.paused) void this.#bootStockfish();
  }

  stopRatedMatch() {
    this.#abortMatch(this.#t("match.unratedStopped"));
  }

  async exportRatedMatches() {
    if (!this.#matchBook.games.length) return;
    const pgn = exportMatches(this.#matchBook);
    this.#downloadText(pgn, "stockfish-uci-elo-matches.pgn");
    await this.#copyText(pgn, this.#t("match.exported"));
  }

  async #playLocalEngineTurn() {
    if (
      !this.#localEngineMode ||
      this.#match ||
      this.#settings.paused ||
      this.#session.isGameOver ||
      this.#session.isPlayerTurn
    )
      return;
    this.#busy = true;
    this.#message = this.#t("analysis.evaluating");
    this.#render();
    const session = this.#session;
    try {
      const { findBestMove } = await import("../core/search.js");
      const answer = findBestMove(session.position, {
        level: this.#engineLevel,
        maxDepth: this.#engineLevel,
        timeLimitMs: 1200,
      });
      if (!this.#localEngineMode || this.#settings.paused || session !== this.#session || !answer.move) return;
      const uci = toUci(answer.move);
      if (!session.position.moveFromUci(uci)) return;
      const result = session.playAiMove(uci); // local mode ONLY; never the chat AI's turn
      if (result.ok) {
        this.#persist();
        this.#updateBadge();
        this.#playSoundForMove(result.entry);
      }
    } catch (error) {
      log.warn("local engine failed", error);
      this.#message = this.#t("analysis.engineFailed");
    } finally {
      this.#busy = false;
      this.#render();
    }
  }

  // --- Analysis ---

  async requestHint() {
    if (this.#busy || this.#settings.paused) return;
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
    if (this.#busy || this.#match || this.#settings.paused) return;
    if (
      this.#settings.confirmDestructive &&
      this.#session.plyCount > 0 &&
      typeof globalThis.confirm === "function" &&
      !globalThis.confirm(this.#t("analysis.confirmEngine"))
    )
      return;
    this.#cancelReply();
    this.#session.reset({ playerColor: this.#settings.playerColor });
    this.#localEngineMode = true;
    this.#matchFinished = false;
    this.#phase = Phase.IDLE;
    this.#message = this.#t("analysis.engineMode");
    this.#persist();
    this.#render();
    if (!this.#session.isPlayerTurn) await this.#playLocalEngineTurn();
  }

  stopEngine() {
    if (this.#match) return;
    if (this.#engineWorker) {
      this.#engineWorker.postMessage({ type: "stop" });
    }
    this.#busy = false;
    this.#setEngineBusy(false);
    this.#message = "";
    this.#render();
  }
}

/** Translation keys for the status action button. */
const ACTION_KEYS = Object.freeze({
  [StatusAction.ASK_AI]: "status.askAi",
  [StatusAction.RETRY]: "status.askAgain",
  [StatusAction.OPEN_AI]: "status.openAi",
  [StatusAction.NEW_GAME]: "status.newGame",
  [StatusAction.RELOAD_TAB]: "status.reloadTab",
  [StatusAction.COPY_PROMPT]: "status.copyPrompt",
  [StatusAction.UNDO_DELETE]: "library.undo",
  [StatusAction.CHECK_CHAT]: "status.checkChat",
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
