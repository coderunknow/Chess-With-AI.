/**
 * Watches the chat transcript for the AI's move — v2.
 *
 * Strategy: every DOM mutation nominates candidate message containers. Once the
 * page has been quiet for `settleMs` (streaming answers mutate continuously), or
 * at the latest after `maxWaitMs`, the newest containers are scanned for a
 * bracketed UCI move. Echoes of our own prompt and the human's own messages are
 * filtered out, duplicates are suppressed, and the result is handed to the
 * callback.
 *
 * v0.2.0 improvements:
 * - Streaming settle: text must be stable for 800ms, not just DOM quiet
 * - Handles markdown/code fences, figurine unicode, 0-0/O-O, e8=Q+, annotations
 * - Detects "plan" replies with no move → notifies panel to retry stricter
 * - Diagnostics: which selector matched, timings
 * - Larger pending queue, periodic scan while awaiting
 * - Sanitised fallback selectors
 *
 * @module content/observer
 */

import { extractMoveCandidates, isEchoOfPrompt } from "../shared/prompt.js";
import { createLogger } from "../shared/log.js";
import {
  collapseWhitespace,
  isElement,
  isUserSideElement,
  newUserMessages,
  normaliseReplyText,
  textOf,
  userMessageSnapshot,
} from "./dom.js";

const log = createLogger("observer");

/** How long the transcript must stay quiet before it is scanned. */
export const SETTLE_MS = 600;

/** Upper bound on how long a scan may be postponed while the page keeps mutating. */
export const MAX_WAIT_MS = 2500;

/** How long text must be stable to be considered settled (streaming). */
export const STABLE_MS = 800;

/** Containers kept in the pending queue. */
export const MAX_PENDING_CONTAINERS = 16;

/** Reported moves are remembered to avoid re-applying the same reply. */
const DEDUPE_MS = 15000;

/** Extra containers probed when a platform has no assistant selectors. */
const FALLBACK_CONTAINER_SELECTORS = Object.freeze([
  "article",
  "[role='article']",
  "[data-testid*='message' i]",
  ".prose",
  "[class*='message' i]",
  "[data-message-author-role='assistant']",
]);

/**
 * @typedef {object} MoveEvent
 * @property {string} move newest bracketed move found.
 * @property {string[]} candidates all bracketed moves in the reply, newest first.
 * @property {string} text the scanned reply text.
 * @property {boolean} [noMove] true when reply has no move (plan reply).
 */

/**
 * @typedef {object} NoMoveEvent
 * @property {string} text scanned text with no move
 * @property {boolean} noMove true
 */

export class MoveWatcher {
  /** @type {MutationObserver|null} */
  #observer = null;
  /** @type {Set<Element>} */
  #pending = new Set();
  /** @type {Map<string, number>} */
  #reported = new Map();
  /** @type {string[]} */
  #sentPrompts = [];
  #settleTimer = 0;
  #maxWaitTimer = 0;
  #stableTimer = 0;
  #lastTexts = new Map();
  /** @type {DiagnosticsCollector|null} */
  #diagnostics = null;
  #lastScanHadNoMove = false;
  #known = new Set();
  #submitted = false;
  #manual = false;
  #awaitEcho = false;
  #expectedPrompt = "";
  #rejectedMoves = new Set();
  #userBefore = new Set();
  #userSelectors = [];

  /**
   * @param {object} options
   * @param {(event: MoveEvent|NoMoveEvent) => void} options.onMove
   * @param {() => string[]} [options.assistantSelectors]
   * @param {() => Array<{selector:string,strategy:string}>} [options.assistantCandidates]
   * @param {number} [options.settleMs]
   * @param {number} [options.maxWaitMs]
   * @param {DiagnosticsCollector} [options.diagnostics]
   * @param {string[]} [options.userSelectors]
   * @param {() => void} [options.onEcho] fired once the matching NEW user-message echo appears
   *   after {@link MoveWatcher#requireUserEcho}.
   */
  constructor({
    onMove,
    assistantSelectors = () => [],
    assistantCandidates = null,
    settleMs = SETTLE_MS,
    maxWaitMs = MAX_WAIT_MS,
    diagnostics = null,
    userSelectors = [],
    onEcho = () => {},
  }) {
    this.onMove = onMove;
    this.onEcho = onEcho;
    this.getAssistantSelectors = assistantSelectors;
    this.getAssistantCandidates = assistantCandidates;
    this.settleMs = settleMs;
    this.maxWaitMs = maxWaitMs;
    this.#diagnostics = diagnostics;
    this.#userSelectors = userSelectors;
  }

  /**
   * Starts observing the document body.
   *
   * @returns {boolean} true when the observer is running.
   */
  start() {
    if (this.#observer || !document.body) {
      return Boolean(this.#observer);
    }
    this.#observer = new MutationObserver((records) => this.#onMutations(records));
    this.#observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    log.debug("watching for AI replies");

    // Do not rescan history on start/resume; only containers new since the
    // request baseline can produce an AI move. No polling interval is needed.
    return true;
  }

  /** Stops observing and clears pending work. */
  stop() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#pending.clear();
    window.clearTimeout(this.#settleTimer);
    window.clearTimeout(this.#maxWaitTimer);
    window.clearTimeout(this.#stableTimer);
    this.#settleTimer = 0;
    this.#maxWaitTimer = 0;
    this.#stableTimer = 0;
    this.#lastTexts.clear();
    this.#submitted = false;
    this.#expectedPrompt = "";
    this.#manual = false;
    this.#awaitEcho = false;
  }

  /**
   * Arms a single reply. Assistant containers already in the page at this
   * point are not eligible, even if they later mutate or the watcher restarts.
   * In manual mode the user's full prompt echo must appear before we arm the
   * assistant side; copying a prompt alone is not proof that it was sent.
   */
  expectReply(prompt, { rejectedMoves = [], manual = false } = {}) {
    this.stop();
    this.rememberPrompt(prompt);
    this.#expectedPrompt = prompt;
    this.#rejectedMoves = new Set(rejectedMoves.map((uci) => String(uci).toLowerCase()));
    this.#reported.clear();
    this.#lastScanHadNoMove = false;
    this.#manual = manual;
    this.#awaitEcho = false;
    this.#userBefore = userMessageSnapshot(document, this.#userSelectors);
    this.#known = this.#existingAssistantContainers();
    this.start();
  }

  /**
   * After ONE submit attempt whose delivery could not be confirmed, a reply
   * may only be attributed to this request once the matching NEW user-message
   * echo appears. Old transcript content or an unrelated chat message can
   * therefore never arm the assistant side. If the echo already rendered, the
   * gate opens immediately.
   */
  requireUserEcho() {
    if (!this.#expectedPrompt || this.#manual) return;
    if (this.#echoSeen()) {
      this.#openEchoGate();
      return;
    }
    this.#awaitEcho = true;
  }

  /** @returns {boolean} true when a NEW user message matches the expected prompt. */
  #echoSeen() {
    if (!this.#expectedPrompt || !this.#userSelectors.length) return false;
    const messages = newUserMessages(document, this.#userSelectors, this.#userBefore, this.#expectedPrompt);
    return messages.some((node) => isEchoOfPrompt(collapseWhitespace(textOf(node)), this.#expectedPrompt));
  }

  #openEchoGate() {
    if (!this.#awaitEcho) return;
    this.#awaitEcho = false;
    try {
      this.onEcho();
    } catch (error) {
      log.debug("onEcho handler failed", error);
    }
  }

  /** Called immediately before Auto submit, or at the full Manual user echo. */
  markSubmitted({ preserveKnown = false } = {}) {
    if (this.#submitted || !this.#expectedPrompt) return;
    this.#submitted = true;
    // Auto: snapshot immediately BEFORE the click. Manual: the mutation batch
    // may already include the echo AND a fast assistant response. Rebasing to
    // the current DOM then would incorrectly classify that reply as history.
    if (!preserveKnown) this.#known = this.#existingAssistantContainers();
  }

  /**
   * Remembers a prompt so its echo in the transcript is not mistaken for a move.
   *
   * @param {string} prompt
   */
  rememberPrompt(prompt) {
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return;
    }
    this.#sentPrompts.push(prompt);
    if (this.#sentPrompts.length > 5) {
      this.#sentPrompts.shift();
    }
  }

  #existingAssistantContainers() {
    const known = new Set();
    const selectors = this.getAssistantCandidates
      ? this.getAssistantCandidates().map((c) => c.selector)
      : this.getAssistantSelectors();
    for (const selector of [...selectors, ...FALLBACK_CONTAINER_SELECTORS]) {
      try {
        for (const element of document.querySelectorAll(selector)) {
          if (!isUserSideElement(element)) known.add(element);
        }
      } catch {
        // Site selector changed; never broaden this to the entire transcript.
      }
    }
    return known;
  }

  /**
   * @param {MutationRecord[]} records
   */
  #onMutations(records) {
    // An unconfirmed submit opens only on the matching NEW user echo — checked
    // for every batch so a late-rendered echo unblocks delivery immediately.
    if (this.#awaitEcho && this.#submitted && this.#echoSeen()) {
      this.#openEchoGate();
    }
    if (this.#manual && !this.#submitted) {
      const messages = newUserMessages(document, this.#userSelectors, this.#userBefore, this.#expectedPrompt);
      const echo =
        messages.length === 1 && collapseWhitespace(textOf(messages[0])) === collapseWhitespace(this.#expectedPrompt)
          ? messages[0]
          : null;
      // Mutation records are chronological. An assistant that appears BEFORE
      // the user has pasted and sent the full prompt must become history, not
      // an eligible reply. If echo and assistant arrive in the same batch,
      // only nodes after the echo are nominated. No DOM-wide rebase here.
      for (const record of records) {
        const added = [...record.addedNodes];
        for (const node of [record.target, ...added]) {
          if (
            !this.#submitted &&
            echo &&
            (node === echo || echo.contains(node) || (added.includes(node) && node.contains?.(echo)))
          ) {
            this.markSubmitted({ preserveKnown: true });
            continue;
          }
          if (this.#submitted) this.#nominate(node);
          else this.#rememberAssistant(node);
        }
      }
    } else if (this.#submitted) {
      for (const record of records) {
        this.#nominate(record.target);
        for (const node of record.addedNodes) this.#nominate(node);
      }
    }
    if (this.#pending.size) this.#schedule();
  }

  #rememberAssistant(node) {
    const element = isElement(node) ? node : node.parentElement;
    if (!isElement(element) || isUserSideElement(element)) return;
    const container = this.#resolveContainer(element);
    if (container) this.#known.add(container);
  }

  /**
   * Adds the closest candidate container of `node` to the pending queue.
   *
   * @param {Node} node
   */
  #nominate(node) {
    const element = isElement(node) ? node : node.parentElement;
    if (!isElement(element) || isUserSideElement(element)) {
      return;
    }

    const container = this.#resolveContainer(element);
    if (!container || this.#known.has(container)) {
      return;
    }

    this.#pending.delete(container);
    this.#pending.add(container);
    while (this.#pending.size > MAX_PENDING_CONTAINERS) {
      const oldest = this.#pending.values().next().value;
      this.#pending.delete(oldest);
    }
  }

  /**
   * @param {Element} element
   * @returns {Element|null} the assistant message container for `element`.
   */
  #resolveContainer(element) {
    const candidates = this.getAssistantCandidates
      ? this.getAssistantCandidates()
      : this.getAssistantSelectors().map((s) => ({ selector: s, strategy: "legacy" }));
    const allSelectors = [...candidates.map((c) => c.selector || c), ...FALLBACK_CONTAINER_SELECTORS];

    for (const selector of allSelectors) {
      const sel = typeof selector === "string" ? selector : selector.selector;
      try {
        const match = element.closest(sel);
        if (match && !isUserSideElement(match)) {
          if (this.#diagnostics) {
            this.#diagnostics.addAttempt("assistant", {
              selector: sel,
              strategy: "assistant",
              matched: true,
              timeMs: 0,
            });
            this.#diagnostics.report.matchedAssistant = sel;
          }
          return match;
        }
      } catch (error) {
        log.debug(`invalid assistant selector "${sel}"`, error);
      }
    }
    return null;
  }

  #schedule() {
    window.clearTimeout(this.#settleTimer);
    this.#settleTimer = window.setTimeout(() => this.#checkStabilityAndScan(), this.settleMs);

    if (this.#maxWaitTimer === 0) {
      this.#maxWaitTimer = window.setTimeout(() => {
        this.#maxWaitTimer = 0;
        this.#scan();
      }, this.maxWaitMs);
    }
  }

  #checkStabilityAndScan() {
    // Check if pending containers have stable text for STABLE_MS
    let allStable = true;
    for (const container of this.#pending) {
      const currentText = textOf(container);
      const last = this.#lastTexts.get(container);
      if (!last || last.text !== currentText) {
        this.#lastTexts.set(container, { text: currentText, timestamp: Date.now() });
        allStable = false;
      } else {
        const age = Date.now() - last.timestamp;
        if (age < STABLE_MS) {
          allStable = false;
        }
      }
    }

    if (!allStable) {
      // Reschedule stability check
      window.clearTimeout(this.#stableTimer);
      this.#stableTimer = window.setTimeout(() => this.#checkStabilityAndScan(), 200);
      return;
    }

    this.#scan();
  }

  #scan() {
    window.clearTimeout(this.#settleTimer);
    window.clearTimeout(this.#maxWaitTimer);
    window.clearTimeout(this.#stableTimer);
    this.#settleTimer = 0;
    this.#maxWaitTimer = 0;
    this.#stableTimer = 0;

    const containers = [...this.#pending];
    this.#pending.clear();

    let foundNoMoveText = "";

    for (let index = containers.length - 1; index >= 0; index -= 1) {
      const rawText = textOf(containers[index]);
      if (!rawText) {
        continue;
      }

      const normalized = normaliseReplyText(rawText);
      if (this.#isEcho(normalized)) {
        continue;
      }

      if (/\b(?:I resign|I concede|I forfeit)\b|^resign[.!]?$/i.test(normalized.trim())) {
        this.onMove({ text: normalized.slice(0, 400), resigned: true });
        return;
      }

      const candidates = extractMoveCandidates(normalized);
      // The first bracketed move is the assistant's answer. Do not skip an
      // already rejected answer to play a later example from its explanation.
      if (candidates.length > 0 && this.#rejectedMoves.has(candidates[0])) {
        this.onMove({ move: candidates[0], text: normalized.slice(0, 400), noMove: true, repeated: true });
        return;
      }
      if (candidates.length === 0) {
        // Keep track of longest no-move text that looks like a plan reply
        if (normalized.length > 50 && normalized.length < 20000) {
          if (normalized.length > foundNoMoveText.length) {
            foundNoMoveText = normalized;
          }
        }
        continue;
      }

      const move = candidates[0];
      if (!this.#shouldReport(move)) {
        continue;
      }

      log.debug("detected AI move", move, candidates);
      this.#lastScanHadNoMove = false;
      this.onMove({ move, candidates, text: normalized.slice(0, 400) });
      return;
    }

    // No move found but we have text that looks like a plan reply
    if (foundNoMoveText && !this.#lastScanHadNoMove) {
      // Only report no-move once per scan cycle to avoid spam
      this.#lastScanHadNoMove = true;
      const looksLikePlan =
        /plan|strategy|think|consider|idea|move|should|would|could/i.test(foundNoMoveText) &&
        foundNoMoveText.length > 100;

      if (looksLikePlan) {
        log.debug("detected plan reply with no move", foundNoMoveText.slice(0, 200));
        this.onMove({ text: foundNoMoveText.slice(0, 1000), noMove: true });
      }
    }
  }

  /**
   * @param {string} text
   * @returns {boolean} true when the text is one of our own prompts.
   */
  #isEcho(text) {
    if (this.#sentPrompts.some((prompt) => isEchoOfPrompt(text, prompt))) {
      return true;
    }
    return text.includes("Chess move request.") || text.includes("Position (FEN):");
  }

  /**
   * @param {string} move
   * @returns {boolean} true when the move has not been reported recently.
   */
  #shouldReport(move) {
    const now = Date.now();
    const previous = this.#reported.get(move);
    if (previous !== undefined && now - previous < DEDUPE_MS) {
      log.debug("ignoring repeated move", move);
      return false;
    }

    this.#reported.set(move, now);
    if (this.#reported.size > 32) {
      for (const [key, timestamp] of this.#reported) {
        if (now - timestamp > DEDUPE_MS) {
          this.#reported.delete(key);
        }
      }
    }
    return true;
  }
}
