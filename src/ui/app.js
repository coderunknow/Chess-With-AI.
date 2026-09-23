/**
 * Side-panel application.
 *
 * Owns the state machine that ties the chess session, the AI chat tab and the
 * DOM together:
 *
 *   idle ──human move──▶ sending ──▶ awaiting ──AI reply──▶ idle
 *                                     │
 *                                     └──illegal reply──▶ retry (bounded)
 *
 * The view is rebuilt from {@link App#render} on every state change; all
 * rendering models come from pure helpers (`describeBoard`, `describeHistory`,
 * `describeStatus`).
 *
 * @module ui/app
 */

import { PIECE_GLYPHS, PIECE_NAMES, colorOf } from "../core/pieces.js";
import { toName } from "../core/squares.js";
import { createLogger } from "../shared/log.js";
import { MessageType, createMessage, describeRuntimeError, normaliseResponse } from "../shared/messaging.js";
import { PLATFORMS, platformForUrl } from "../shared/platforms.js";
import { buildMovePrompt, buildOpeningPrompt, buildRetryPrompt } from "../shared/prompt.js";
import { DEFAULT_SETTINGS, SETTINGS_KEY, mergeSettings } from "../shared/settings.js";
import { readValue, removeValue, writeValue } from "../shared/storage.js";
import { BoardView, describeBoard, squaresOfUci } from "./board.js";
import { GameSession, MoveError } from "./game.js";
import { HistoryView } from "./history.js";
import { StatusAction, describeStatus } from "./status.js";

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

  /**
   * @param {object} refs DOM references resolved by `main.js`.
   */
  constructor(refs) {
    this.#refs = refs;
    this.#session = new GameSession();
    this.#boardView = new BoardView(refs.board, { onSelect: (square) => void this.selectSquare(square) });
    this.#historyView = new HistoryView({ list: refs.moveList, empty: refs.moveListEmpty });
    this.#bindEvents();
    this.#renderPlatformOptions();
  }

  /** @returns {GameSession} the active session (read-only use). */
  get session() {
    return this.#session;
  }

  /**
   * Restores settings and the previous game, then performs the first render.
   *
   * @returns {Promise<void>}
   */
  async start() {
    this.#settings = mergeSettings(await readValue(SETTINGS_KEY, {}));
    const snapshot = await readValue(GAME_KEY, null);
    if (this.#settings.persistGame && snapshot) {
      this.#session = GameSession.fromSnapshot(snapshot, { playerColor: this.#settings.playerColor });
      log.info(`restored a game with ${this.#session.plyCount} plies`);
    } else {
      this.#session = new GameSession({ playerColor: this.#settings.playerColor });
    }

    this.#applySettingsToDialog();
    this.#render();
    await this.refreshConnection();
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
    const session = this.#session;

    if (session.isGameOver) {
      this.#message = "The game is over — start a new game to keep playing.";
      this.#render();
      return;
    }

    if (!session.isPlayerTurn) {
      this.#message = "It is the AI's turn.";
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
        ? "That piece belongs to the AI."
        : "Select one of your pieces first.";
      this.#render();
      return;
    }

    const targets = session.legalTargets(square);
    this.#selected = square;
    this.#targets = targets;
    this.#message = targets.length === 0 ? "That piece has no legal moves." : "";
    this.#render();
    this.#boardView.focus(square);
  }

  /**
   * @param {{move?: string, candidates?: string[]}} payload
   * @returns {Promise<void>}
   */
  async handleAiMove(payload) {
    const session = this.#session;
    if (session.isGameOver) {
      return;
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
      this.#persist();
      this.#render();
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

  /**
   * Asks the AI to move in the current position. Used when the player takes
   * Black, after a page reload, and by the "ask again" action.
   *
   * @returns {Promise<void>}
   */
  async requestAiMove() {
    if (this.#session.isGameOver || this.#session.isPlayerTurn) {
      return;
    }
    const prompt =
      this.#session.plyCount === 0
        ? buildOpeningPrompt({ aiColor: this.#session.aiColor, fen: this.#session.fen })
        : this.#movePrompt();
    await this.#sendPrompt(prompt, { expected: "ai-move" });
  }

  /** Starts a new game with the configured colour. */
  resetGame() {
    this.#session.reset({ playerColor: this.#settings.playerColor });
    this.#flipOverride = null;
    this.#clearSelection();
    this.#phase = Phase.IDLE;
    this.#message = "New game. Good luck!";
    this.#persist();
    this.#render();
  }

  /** Undoes the last move pair. */
  undo() {
    const result = this.#session.undo();
    this.#phase = Phase.IDLE;
    this.#clearSelection();
    this.#message = result.ok ? `Took back ${result.plies} ${result.plies === 1 ? "ply" : "plies"}.` : result.error;
    this.#persist();
    this.#render();
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
    this.#applySettingsToDialog();
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

    this.#render();
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
    const session = this.#session;
    const promotions = session.position.legalMovesFrom(from).filter((move) => move.to === to && move.promotion);

    let promotion = "";
    if (promotions.length > 0) {
      promotion = await this.#askPromotionPiece(session.position.pieceAt(from));
      if (!promotion) {
        this.#message = "Promotion cancelled.";
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

    if (session.isGameOver) {
      this.#phase = Phase.IDLE;
      this.#render();
      return;
    }

    await this.#sendPrompt(this.#movePrompt(), { expected: "ai-move" });
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
      this.#message = `The AI answered [${illegalMove}], which is not legal here. Ask again or adjust the position.`;
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
    if (!this.#connection.supported || !Number.isInteger(this.#connection.tabId)) {
      log.debug("no supported AI tab is active; the prompt was not sent");
      this.#phase = Phase.IDLE;
      this.#message = "";
      this.#render();
      return false;
    }

    this.#phase = Phase.SENDING;
    this.#message = retry > 0 ? `Asking the AI again (attempt ${retry})…` : "";
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
        this.#render();
        return false;
      }

      this.#phase = Phase.AWAITING;
      this.#message = "";
      this.#render();
      return true;
    } catch (error) {
      const detail = describeRuntimeError(error) || String(error);
      this.#phase = Phase.ERROR;
      this.#message = `Could not reach the AI tab: ${detail}`;
      this.#render();
      return false;
    }
  }

  /**
   * Makes sure the bridge script is present in the tab.
   *
   * @param {number} tabId
   * @returns {Promise<void>}
   */
  async #ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, createMessage(MessageType.PING));
      return;
    } catch {
      log.debug("content script missing, injecting");
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    } catch (error) {
      log.warn("could not inject the content script", describeRuntimeError(error));
    }
  }

  /**
   * @param {string} color piece colour of the promoting pawn.
   * @returns {Promise<string>} chosen piece type, or `''` when cancelled.
   */
  async #askPromotionPiece(color) {
    const dialog = this.#refs.promotionDialog;
    const isWhite = colorOf(color) === "w";

    for (const button of dialog.buttons) {
      const piece = button.dataset.piece || "q";
      const glyph = isWhite ? PIECE_GLYPHS[piece.toUpperCase()] : PIECE_GLYPHS[piece];
      button.textContent = glyph;
      button.setAttribute("aria-label", `Promote to ${PIECE_NAMES[piece]}`);
    }
    dialog.root.showModal();

    try {
      return await new Promise((resolve) => {
        const finish = (value) => {
          dialog.root.removeEventListener("click", onClick);
          dialog.root.removeEventListener("cancel", onCancel);
          dialog.root.removeEventListener("close", onCancel);
          if (dialog.root.open) {
            dialog.root.close();
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
  }

  #bindEvents() {
    const { controls, pgnDialog, settingsDialog, platformBanner } = this.#refs;

    controls.undo.addEventListener("click", () => this.undo());
    controls.newGame.addEventListener("click", () => this.resetGame());
    controls.flip.addEventListener("click", () => {
      this.#flipOverride = !this.#effectiveFlipped();
      this.#render();
    });
    controls.askAi.addEventListener("click", () => void this.requestAiMove());
    controls.copyPgn.addEventListener("click", () => void this.#copyPgn());
    controls.openPgn.addEventListener("click", () => this.#openPgnDialog());
    controls.copyFen.addEventListener("click", () => void this.#copyText(this.#session.fen, "FEN copied."));
    controls.statusAction.addEventListener("click", () => void this.#runStatusAction());
    settingsDialog.root.addEventListener("close", () => this.#render());
    settingsDialog.controls.side.addEventListener("change", (event) => {
      const value = /** @type {HTMLSelectElement} */ (event.target).value;
      void this.updateSettings({ playerColor: value === "b" ? "b" : "w" });
    });
    settingsDialog.controls.theme.addEventListener("change", (event) => {
      const value = /** @type {HTMLSelectElement} */ (event.target).value;
      void this.updateSettings({ theme: value === "light" ? "light" : "dark" });
    });

    for (const input of settingsDialog.controls.toggles) {
      input.addEventListener("change", () => {
        const key = input.dataset.setting;
        if (!key) {
          return;
        }
        void this.updateSettings({ [key]: input.checked });
      });
    }

    pgnDialog.load.addEventListener("click", () => this.#loadPgnFromDialog());
    pgnDialog.copy.addEventListener("click", () => void this.#copyText(pgnDialog.textarea.value, "PGN copied."));
    platformBanner.open.addEventListener("click", () => void this.#openSelectedPlatform());

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === MessageType.AI_MOVE) {
        void this.handleAiMove(message);
        return;
      }
      if (message?.type === MessageType.CONTENT_STATUS && typeof message.error === "string" && message.error) {
        this.#message = message.error;
        this.#phase = Phase.ERROR;
        this.#render();
        return;
      }
      if (message?.type === MessageType.ACTIVE_TAB_CHANGED) {
        this.#setConnection(message);
        this.#render();
      }
    });
  }

  #renderPlatformOptions() {
    const { select } = this.#refs.platformBanner;
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
    await this.#copyText(this.#session.toPgn(), "PGN copied to the clipboard.");
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
    } catch (error) {
      log.warn("clipboard unavailable", error);
      this.#message = "Copying failed — your browser blocked clipboard access.";
      this.#phase = Phase.ERROR;
    }
    this.#render();
  }

  async #runStatusAction() {
    const status = this.#status();
    switch (status.action) {
      case StatusAction.ASK_AI:
      case StatusAction.RETRY:
        await this.requestAiMove();
        break;
      case StatusAction.OPEN_AI:
        this.#refs.platformBanner.root.open = true;
        break;
      case StatusAction.NEW_GAME:
        this.resetGame();
        break;
      default:
        break;
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
      busy: this.#phase === Phase.SENDING,
    });
  }

  /** Schedules a debounced snapshot write. */
  #persist() {
    window.clearTimeout(this.#persistTimer);
    this.#persistTimer = window.setTimeout(() => {
      if (!this.#settings.persistGame) {
        return;
      }
      void writeValue(GAME_KEY, this.#session.snapshot());
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
      { selected: this.#selected, interactive: session.isPlayerTurn && !session.isGameOver },
    );

    this.#historyView.render(session.history, {
      startMoveNumber: this.#historyStartNumber(),
      firstMover: this.#historyFirstMover(),
    });

    const { status: statusNode, statusAction, turn, opponent, fen, controls } = this.#refs;
    statusNode.textContent = status.text;
    statusNode.dataset.kind = status.kind;
    statusAction.hidden = status.action === StatusAction.NONE;
    statusAction.textContent = ACTION_LABELS[status.action] || "";
    statusAction.dataset.action = status.action;

    turn.textContent = session.isGameOver ? "Game over" : session.turn === "w" ? "White to move" : "Black to move";
    opponent.textContent = this.#connection.supported
      ? `${this.#connection.label} (${session.aiColor === "w" ? "White" : "Black"})`
      : "No AI chat open";
    fen.textContent = session.fen;

    controls.undo.disabled = session.plyCount === 0;
    controls.askAi.hidden = !(session.isWaitingForAi && !session.isGameOver);
    controls.askAi.disabled = this.#phase === Phase.SENDING;
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
    settingsDialog.controls.side.value = this.#settings.playerColor;
    settingsDialog.controls.theme.value = this.#settings.theme;
    document.body.dataset.theme = this.#settings.theme;
    for (const input of settingsDialog.controls.toggles) {
      const key = input.dataset.setting;
      if (key && key in this.#settings) {
        input.checked = Boolean(this.#settings[/** @type {keyof typeof this.#settings} */ (key)]);
      }
    }
  }
}

/** Labels for the status action button. */
const ACTION_LABELS = Object.freeze({
  [StatusAction.ASK_AI]: "Ask the AI to move",
  [StatusAction.RETRY]: "Ask again",
  [StatusAction.OPEN_AI]: "Open an AI chat",
  [StatusAction.NEW_GAME]: "New game",
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
