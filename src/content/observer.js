/**
 * Watches the chat transcript for the AI's move.
 *
 * Strategy: every DOM mutation nominates candidate message containers. Once the
 * page has been quiet for `settleMs` (streaming answers mutate continuously), or
 * at the latest after `maxWaitMs`, the newest containers are scanned for a
 * bracketed UCI move. Echoes of our own prompt and the human's own messages are
 * filtered out, duplicates are suppressed, and the result is handed to the
 * callback.
 *
 * @module content/observer
 */

import { extractMoveCandidates, isEchoOfPrompt } from "../shared/prompt.js";
import { createLogger } from "../shared/log.js";
import { isElement, isUserSideElement, textOf } from "./dom.js";

const log = createLogger("observer");

/** How long the transcript must stay quiet before it is scanned. */
export const SETTLE_MS = 600;

/** Upper bound on how long a scan may be postponed while the page keeps mutating. */
export const MAX_WAIT_MS = 2500;

/** Containers kept in the pending queue. */
const MAX_PENDING_CONTAINERS = 8;

/** Reported moves are remembered to avoid re-applying the same reply. */
const DEDUPE_MS = 15000;

/** Extra containers probed when a platform has no assistant selectors. */
const FALLBACK_CONTAINER_SELECTORS = Object.freeze([
  "article",
  "[role='article']",
  "[data-testid*='message' i]",
  ".prose",
  "[class*='message' i]",
]);

/**
 * @typedef {object} MoveEvent
 * @property {string} move newest bracketed move found.
 * @property {string[]} candidates all bracketed moves in the reply, newest first.
 * @property {string} text the scanned reply text.
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

  /**
   * @param {object} options
   * @param {(event: MoveEvent) => void} options.onMove
   * @param {() => string[]} [options.assistantSelectors]
   * @param {number} [options.settleMs]
   * @param {number} [options.maxWaitMs]
   */
  constructor({ onMove, assistantSelectors = () => [], settleMs = SETTLE_MS, maxWaitMs = MAX_WAIT_MS }) {
    this.onMove = onMove;
    this.getAssistantSelectors = assistantSelectors;
    this.settleMs = settleMs;
    this.maxWaitMs = maxWaitMs;
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
    return true;
  }

  /** Stops observing and clears pending work. */
  stop() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#pending.clear();
    window.clearTimeout(this.#settleTimer);
    window.clearTimeout(this.#maxWaitTimer);
    this.#settleTimer = 0;
    this.#maxWaitTimer = 0;
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

  /**
   * @param {MutationRecord[]} records
   */
  #onMutations(records) {
    for (const record of records) {
      this.#nominate(record.target);
      for (const node of record.addedNodes) {
        this.#nominate(node);
      }
    }
    if (this.#pending.size === 0) {
      return;
    }
    this.#schedule();
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
    if (!container) {
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
    for (const selector of [...this.getAssistantSelectors(), ...FALLBACK_CONTAINER_SELECTORS]) {
      try {
        const match = element.closest(selector);
        if (match && !isUserSideElement(match)) {
          return match;
        }
      } catch (error) {
        log.debug(`invalid assistant selector "${selector}"`, error);
      }
    }
    return null;
  }

  #schedule() {
    window.clearTimeout(this.#settleTimer);
    this.#settleTimer = window.setTimeout(() => this.#scan(), this.settleMs);

    if (this.#maxWaitTimer === 0) {
      this.#maxWaitTimer = window.setTimeout(() => {
        this.#maxWaitTimer = 0;
        this.#scan();
      }, this.maxWaitMs);
    }
  }

  #scan() {
    window.clearTimeout(this.#settleTimer);
    window.clearTimeout(this.#maxWaitTimer);
    this.#settleTimer = 0;
    this.#maxWaitTimer = 0;

    const containers = [...this.#pending];
    this.#pending.clear();

    for (let index = containers.length - 1; index >= 0; index -= 1) {
      const text = textOf(containers[index]);
      if (!text || this.#isEcho(text)) {
        continue;
      }

      const candidates = extractMoveCandidates(text);
      if (candidates.length === 0) {
        continue;
      }

      const move = candidates[0];
      if (!this.#shouldReport(move)) {
        continue;
      }

      log.debug("detected AI move", move, candidates);
      this.onMove({ move, candidates, text: text.slice(0, 400) });
      return;
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
