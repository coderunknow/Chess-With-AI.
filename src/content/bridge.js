/**
 * Drives the AI chat composer: locating the input, typing the prompt and
 * submitting it — v2 with verification, diagnostics and degraded mode.
 *
 * Each supported platform ships an ordered candidate list with strategy hints
 * (see `shared/platforms.js`), with generic fallbacks appended so that a
 * redesign on one site does not break the others.
 *
 * @module content/bridge
 */

import { createLogger } from "../shared/log.js";
import { DiagnosticsCollector } from "../shared/diagnostics.js";
import {
  findFirstWithDiagnostics,
  isBusyIndicator,
  isComposerEmpty,
  isEditable,
  isVisible,
  pressEnter,
  readComposer,
  tryRequestSubmit,
  typeIntoWithStrategies,
  verifyComposerContains,
  waitFor,
  waitForUserMessage,
} from "./dom.js";
import { inputCandidatesForHost, sendCandidatesForHost, userSelectorsForHost } from "../shared/platforms.js";

const log = createLogger("bridge");

/** How long to wait for a composer to appear. */
export const INPUT_TIMEOUT_MS = 5000;

/** How long to wait after submitting before checking the composer cleared. */
export const SUBMIT_SETTLE_MS = 800;

/** How long to wait for user message confirmation. */
export const USER_MESSAGE_TIMEOUT_MS = 2000;

/** Outcomes reported back to the side panel. */
export const SendResult = Object.freeze({
  OK: "ok",
  NO_INPUT: "input-missing",
  TYPE_FAILED: "type-failed",
  SUBMIT_FAILED: "submit-failed",
  VERIFY_FAILED: "verify-failed",
});

export class ChatBridge {
  /** @type {HTMLElement|null} */
  #input = null;
  /** @type {Array<{selector:string,strategy:string}>} */
  #inputCandidates;
  /** @type {Array<{selector:string,strategy:string}>} */
  #sendCandidates;
  /** @type {string[]} */
  #userSelectors;
  /** @type {DiagnosticsCollector} */
  #diagnostics;
  #hostname;
  #inFlight = false;

  /**
   * @param {object} [options]
   * @param {string} [options.hostname] defaults to the current location.
   * @param {number} [options.inputTimeout]
   * @param {DiagnosticsCollector} [options.diagnostics]
   */
  constructor({
    hostname = globalThis.location?.hostname || "",
    inputTimeout = INPUT_TIMEOUT_MS,
    diagnostics = null,
  } = {}) {
    this.#hostname = hostname;
    this.#inputCandidates = inputCandidatesForHost(hostname);
    this.#sendCandidates = sendCandidatesForHost(hostname);
    this.#userSelectors = userSelectorsForHost(hostname);
    this.inputTimeout = inputTimeout;
    this.#diagnostics =
      diagnostics || new DiagnosticsCollector({ platform: this.#hostname, url: globalThis.location?.href || "" });
  }

  /** @returns {DiagnosticsCollector} */
  get diagnostics() {
    return this.#diagnostics;
  }

  /** @returns {string} hostname this bridge was created for (diagnostics). */
  get hostname() {
    return this.#hostname;
  }

  /**
   * @returns {HTMLElement|null} the bottom-most usable composer on the page.
   */
  findInput() {
    if (this.#input && this.#input.isConnected && isEditable(this.#input)) {
      return this.#input;
    }

    const candidates = [];
    const allAttempts = [];

    for (const candidate of this.#inputCandidates) {
      const start = Date.now();
      let matched = false;
      try {
        const matches = document.querySelectorAll(candidate.selector);
        for (const element of matches) {
          if (isEditable(element) && !candidates.includes(element)) {
            candidates.push(element);
            matched = true;
          }
        }
      } catch (error) {
        log.debug(`invalid input selector "${candidate.selector}"`, error);
      }
      const timeMs = Date.now() - start;
      allAttempts.push({ selector: candidate.selector, strategy: candidate.strategy, matched, timeMs });
    }

    // Record diagnostics
    for (const attempt of allAttempts) {
      this.#diagnostics.addAttempt("composer", attempt);
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
   * @returns {{button:HTMLElement|null, attempts:Array}}
   */
  findSendButtonWithDiagnostics(input) {
    const scopes = [input.closest("form"), input.parentElement?.parentElement, input.parentElement, document].filter(
      Boolean,
    );

    const allAttempts = [];
    for (const scope of scopes) {
      const { element, attempts } = findFirstWithDiagnostics(
        scope,
        this.#sendCandidates,
        (element) =>
          isVisible(element) &&
          !isBusyIndicator(element) &&
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-disabled") !== "true",
      );
      allAttempts.push(...attempts);
      if (element) {
        for (const att of allAttempts) {
          this.#diagnostics.addAttempt("send", att);
        }
        return { button: /** @type {HTMLElement} */ (element), attempts: allAttempts };
      }
    }

    for (const att of allAttempts) {
      this.#diagnostics.addAttempt("send", att);
    }
    return { button: null, attempts: allAttempts };
  }

  /**
   * @param {HTMLElement} input
   * @returns {HTMLElement|null} the submit button belonging to `input`.
   */
  findSendButton(input) {
    return this.findSendButtonWithDiagnostics(input).button;
  }

  /**
   * Types a prompt into the composer and submits it, with verification and
   * diagnostics. Never submits an empty composer. Guards against double
   * submission.
   *
   * @param {string} prompt
   * @returns {Promise<{ok: boolean, method: string, error: string, result: string, diagnostics: object}>}
   */
  async send(prompt) {
    if (this.#inFlight) {
      return this.#failure(SendResult.SUBMIT_FAILED, "A prompt is already being sent — please wait.");
    }
    this.#inFlight = true;
    const totalStart = Date.now();

    try {
      const findStart = Date.now();
      const input = await waitFor(() => this.findInput(), { timeout: this.inputTimeout });
      const findTime = Date.now() - findStart;
      this.#diagnostics.setTimings({ findInput: findTime });

      if (!input) {
        this.#diagnostics.setError("composer not found");
        return this.#failure(
          SendResult.NO_INPUT,
          "Could not find the chat input box on this page. Copy the prompt and paste it manually.",
        );
      }

      const typeStart = Date.now();
      const typed = typeIntoWithStrategies(input, prompt);
      const typeTime = Date.now() - typeStart;
      this.#diagnostics.setTimings({ type: typeTime });
      this.#diagnostics.setTypingMethod(typed.method);

      if (!typed.ok) {
        this.#diagnostics.setError("typing failed");
        return this.#failure(SendResult.TYPE_FAILED, "Could not type the chess prompt into the chat input box.");
      }

      // Verify composer actually contains text before submitting
      if (!verifyComposerContains(input, prompt)) {
        this.#diagnostics.setError("verify failed after typing");
        return this.#failure(
          SendResult.VERIFY_FAILED,
          "Typed text did not appear in the chat box. Try copying the prompt manually.",
        );
      }

      // Double-check not empty
      if (isComposerEmpty(input)) {
        this.#diagnostics.setError("composer empty after typing");
        return this.#failure(SendResult.TYPE_FAILED, "The chat box is empty after typing — copy the prompt manually.");
      }

      const submitStart = Date.now();
      const method = await this.#submit(input);
      const submitTime = Date.now() - submitStart;
      this.#diagnostics.setTimings({ submit: submitTime, total: Date.now() - totalStart });
      this.#diagnostics.setSubmitMethod(method);

      if (!method) {
        this.#diagnostics.setError("submit failed");
        return this.#failure(SendResult.SUBMIT_FAILED, "Could not submit the prompt. Send it manually to continue.");
      }

      return { ok: true, method, error: "", result: SendResult.OK, diagnostics: this.#diagnostics.report };
    } finally {
      this.#inFlight = false;
    }
  }

  /**
   * @param {HTMLElement} input
   * @returns {Promise<string>} how the prompt was submitted, or '' on failure.
   */
  async #submit(input) {
    const { button } = this.findSendButtonWithDiagnostics(input);

    // Strategy 1: click send button
    if (button) {
      try {
        button.click();
        if (await this.#didSubmit(input)) {
          // Also wait for user message confirmation
          const confirmed = await waitForUserMessage(document, this.#userSelectors, USER_MESSAGE_TIMEOUT_MS);
          log.debug(`submit via button, user message confirmed: ${confirmed}`);
          return confirmed ? "button-confirmed" : "button";
        }
      } catch (error) {
        log.debug("button click failed", error);
      }
      log.debug("send button did not clear the composer, falling back to Enter");
    }

    // Strategy 2: Enter key
    try {
      pressEnter(input);
      if (await this.#didSubmit(input)) {
        const confirmed = await waitForUserMessage(document, this.#userSelectors, USER_MESSAGE_TIMEOUT_MS);
        return button
          ? confirmed
            ? "enter-after-button-confirmed"
            : "enter-after-button"
          : confirmed
            ? "enter-confirmed"
            : "enter";
      }
    } catch (error) {
      log.debug("Enter submit failed", error);
    }

    // Strategy 3: requestSubmit
    try {
      if (tryRequestSubmit(input)) {
        if (await this.#didSubmit(input)) {
          return "requestSubmit";
        }
      }
    } catch (error) {
      log.debug("requestSubmit failed", error);
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
      // Also check if composer text changed significantly (some sites don't clear but replace)
      const current = readComposer(input);
      if (current.trim() === "" || current.length < 10) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
    return false;
  }

  /**
   * @param {string} result one of {@link SendResult}.
   * @param {string} error
   * @returns {{ok: false, method: string, error: string, result: string, diagnostics: object}}
   */
  #failure(result, error) {
    log.warn(result, error);
    this.#diagnostics.setError(error);
    return { ok: false, method: "", error, result, diagnostics: this.#diagnostics.report };
  }
}
