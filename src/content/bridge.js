/**
 * Drives the AI chat composer: locating the input, typing the prompt and
 * submitting it.
 *
 * Each supported platform ships its own selector list (see
 * `shared/platforms.js`), with generic fallbacks appended so that a redesign on
 * one site does not break the others.
 *
 * @module content/bridge
 */

import { createLogger } from "../shared/log.js";
import { isBusyIndicator, isComposerEmpty, isEditable, isVisible } from "./dom.js";
import { findFirst, pressEnter, typeInto, waitFor } from "./dom.js";
import {
  GENERIC_INPUT_SELECTORS,
  GENERIC_SEND_SELECTORS,
  inputSelectorsForHost,
  sendSelectorsForHost,
} from "../shared/platforms.js";

const log = createLogger("bridge");

/** How long to wait for a composer to appear. */
export const INPUT_TIMEOUT_MS = 5000;

/** How long to wait after submitting before checking the composer cleared. */
export const SUBMIT_SETTLE_MS = 400;

/** Outcomes reported back to the side panel. */
export const SendResult = Object.freeze({
  OK: "ok",
  NO_INPUT: "input-missing",
  TYPE_FAILED: "type-failed",
  SUBMIT_FAILED: "submit-failed",
});

export class ChatBridge {
  /** @type {HTMLElement|null} */
  #input = null;
  /** @type {string[]} */
  #inputSelectors;
  /** @type {string[]} */
  #sendSelectors;

  /**
   * @param {object} [options]
   * @param {string} [options.hostname] defaults to the current location.
   * @param {number} [options.inputTimeout]
   */
  constructor({ hostname = globalThis.location?.hostname || "", inputTimeout = INPUT_TIMEOUT_MS } = {}) {
    this.#inputSelectors = [...inputSelectorsForHost(hostname), ...GENERIC_INPUT_SELECTORS];
    this.#sendSelectors = [...sendSelectorsForHost(hostname), ...GENERIC_SEND_SELECTORS];
    this.inputTimeout = inputTimeout;
  }

  /**
   * @returns {HTMLElement|null} the bottom-most usable composer on the page.
   */
  findInput() {
    if (this.#input && this.#input.isConnected && isEditable(this.#input)) {
      return this.#input;
    }

    const candidates = [];
    for (const selector of this.#inputSelectors) {
      let matches;
      try {
        matches = document.querySelectorAll(selector);
      } catch (error) {
        log.debug(`invalid input selector "${selector}"`, error);
        continue;
      }
      for (const element of matches) {
        if (isEditable(element) && !candidates.includes(element)) {
          candidates.push(element);
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Chat composers live at the bottom of the viewport: prefer the lowest one.
    candidates.sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom);
    this.#input = /** @type {HTMLElement} */ (candidates[0]);
    return this.#input;
  }

  /**
   * @param {HTMLElement} input
   * @returns {HTMLElement|null} the submit button belonging to `input`.
   */
  findSendButton(input) {
    const scopes = [input.closest("form"), input.parentElement?.parentElement, input.parentElement, document].filter(
      Boolean,
    );

    for (const scope of scopes) {
      const button = findFirst(
        scope,
        this.#sendSelectors,
        (element) =>
          isVisible(element) &&
          !isBusyIndicator(element) &&
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-disabled") !== "true",
      );
      if (button) {
        return /** @type {HTMLElement} */ (button);
      }
    }
    return null;
  }

  /**
   * Types a prompt into the composer and submits it.
   *
   * @param {string} prompt
   * @returns {Promise<{ok: boolean, method: string, error: string, result: string}>}
   */
  async send(prompt) {
    const input = await waitFor(() => this.findInput(), { timeout: this.inputTimeout });
    if (!input) {
      return this.#failure(SendResult.NO_INPUT, "Could not find the chat input box on this page.");
    }

    if (!typeInto(input, prompt)) {
      return this.#failure(SendResult.TYPE_FAILED, "Could not type the chess prompt into the chat input box.");
    }

    const method = await this.#submit(input);
    if (!method) {
      return this.#failure(SendResult.SUBMIT_FAILED, "Could not submit the prompt. Send it manually to continue.");
    }

    return { ok: true, method, error: "", result: SendResult.OK };
  }

  /**
   * @param {HTMLElement} input
   * @returns {Promise<string>} how the prompt was submitted, or `''` on failure.
   */
  async #submit(input) {
    const button = this.findSendButton(input);
    if (button) {
      button.click();
      if (await this.#didSubmit(input)) {
        return "button";
      }
      log.debug("send button did not clear the composer, falling back to Enter");
    }

    pressEnter(input);
    if (await this.#didSubmit(input)) {
      return button ? "enter-after-button" : "enter";
    }
    return "";
  }

  /**
   * @param {HTMLElement} input
   * @returns {Promise<boolean>} true when the composer emptied itself, which is
   *   how every supported site acknowledges a sent message.
   */
  async #didSubmit(input) {
    const deadline = Date.now() + SUBMIT_SETTLE_MS;
    while (Date.now() < deadline) {
      if (isComposerEmpty(input) || !input.isConnected) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
    return false;
  }

  /**
   * @param {string} result one of {@link SendResult}.
   * @param {string} error
   * @returns {{ok: false, method: string, error: string, result: string}}
   */
  #failure(result, error) {
    log.warn(result, error);
    return { ok: false, method: "", error, result };
  }
}
