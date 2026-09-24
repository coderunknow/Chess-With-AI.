/**
 * The one-shot, fail-closed chat composer bridge. A send button can turn into
 * Stop during generation, so one request has exactly one submit event and never
 * falls back to Enter after a click. All six hosts share this contract.
 *
 * @module content/bridge
 */

import { createLogger } from "../shared/log.js";
import { DiagnosticsCollector } from "../shared/diagnostics.js";
import {
  findFirstWithDiagnostics,
  collapseWhitespace,
  isComposerEmpty,
  isEditable,
  isSendControl,
  isStopControl,
  isStreamingElement,
  isVisible,
  newUserMessages,
  pressEnter,
  textOf,
  typeIntoWithStrategies,
  userMessageSnapshot,
  verifyComposerContains,
} from "./dom.js";
import {
  inputCandidatesForHost,
  sendCandidatesForHost,
  stopCandidatesForHost,
  userSelectorsForHost,
} from "../shared/platforms.js";

const log = createLogger("bridge");
export const INPUT_TIMEOUT_MS = 5000;
export const GENERATION_WAIT_MS = 120000;
/** Wait for confirmation after ONE submit, without submitting again. */
export const SUBMIT_SETTLE_MS = 6000;
/** A short window to catch a duplicated user message after initial confirmation. */
export const USER_MESSAGE_TIMEOUT_MS = 350;

export const SendResult = Object.freeze({
  OK: "ok",
  NO_INPUT: "input-missing",
  GENERATION_TIMEOUT: "generation-timeout",
  TYPE_FAILED: "type-failed",
  SUBMIT_FAILED: "submit-failed",
  VERIFY_FAILED: "verify-failed",
});

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

export class ChatBridge {
  #input = null;
  #inputCandidates;
  #sendCandidates;
  #stopCandidates;
  #userSelectors;
  #diagnostics;
  #hostname;
  #inFlight = false;
  #cancelled = false;

  constructor({
    hostname = globalThis.location?.hostname || "",
    inputTimeout = INPUT_TIMEOUT_MS,
    generationWaitMs = GENERATION_WAIT_MS,
    submitSettleMs = SUBMIT_SETTLE_MS,
    diagnostics = null,
  } = {}) {
    this.#hostname = hostname;
    this.#inputCandidates = inputCandidatesForHost(hostname);
    this.#sendCandidates = sendCandidatesForHost(hostname);
    this.#stopCandidates = stopCandidatesForHost(hostname);
    this.#userSelectors = userSelectorsForHost(hostname);
    this.inputTimeout = inputTimeout;
    this.generationWaitMs = generationWaitMs;
    this.submitSettleMs = submitSettleMs;
    this.#diagnostics =
      diagnostics || new DiagnosticsCollector({ platform: hostname, url: globalThis.location?.href || "" });
  }

  get diagnostics() {
    return this.#diagnostics;
  }

  get hostname() {
    return this.#hostname;
  }

  get inFlight() {
    return this.#inFlight;
  }

  cancel() {
    this.#cancelled = true;
  }

  /** Bottom-most visible, editable composer. */
  findInput() {
    if (this.#input?.isConnected && isEditable(this.#input)) return this.#input;
    const candidates = [];
    for (const candidate of this.#inputCandidates) {
      const start = Date.now();
      let matched = false;
      try {
        for (const element of document.querySelectorAll(candidate.selector)) {
          if (isEditable(element) && !candidates.includes(element)) {
            candidates.push(element);
            matched = true;
          }
        }
      } catch (error) {
        log.debug(`invalid input selector "${candidate.selector}"`, error);
      }
      this.#diagnostics.addAttempt("composer", {
        selector: candidate.selector,
        strategy: candidate.strategy,
        matched,
        timeMs: Date.now() - start,
      });
    }
    candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    this.#input = candidates[0] || null;
    return this.#input;
  }

  /** Check both the stop button and platform streaming markers, not a class hash. */
  findGenerationState() {
    const selectors = [...this.#stopCandidates.map((c) => c.selector), "button", "[role='button']"];
    for (const selector of selectors) {
      try {
        for (const element of document.querySelectorAll(selector)) {
          if (!isVisible(element)) continue;
          if (isStopControl(element)) return { generating: true, stopSeen: true };
          if (isStreamingElement(element)) return { generating: true, stopSeen: false };
        }
      } catch (error) {
        log.debug(`invalid stop selector "${selector}"`, error);
      }
    }
    return { generating: false, stopSeen: false };
  }

  /** Only a named send/submit control; unlabeled buttons cannot be trusted. */
  findSendButtonWithDiagnostics(input) {
    const scopes = [input.closest("form"), input.parentElement?.parentElement, input.parentElement, document].filter(
      Boolean,
    );
    const allAttempts = [];
    for (const scope of scopes) {
      const { element, attempts } = findFirstWithDiagnostics(
        scope,
        this.#sendCandidates,
        (candidate) =>
          isVisible(candidate) &&
          isSendControl(candidate) &&
          !candidate.hasAttribute("disabled") &&
          candidate.getAttribute("aria-disabled") !== "true",
      );
      allAttempts.push(...attempts);
      if (element) {
        allAttempts.forEach((attempt) => this.#diagnostics.addAttempt("send", attempt));
        return { button: element, attempts: allAttempts };
      }
    }
    allAttempts.forEach((attempt) => this.#diagnostics.addAttempt("send", attempt));
    return { button: null, attempts: allAttempts };
  }

  findSendButton(input) {
    return this.findSendButtonWithDiagnostics(input).button;
  }

  /**
   * @param {string} prompt
   * @param {{onStatus?:(state:string)=>void, onSubmit?:()=>void}} [callbacks]
   */
  async send(prompt, { onStatus = () => {}, onSubmit = () => {} } = {}) {
    if (this.#inFlight) {
      return this.#failure(SendResult.SUBMIT_FAILED, "A prompt is already being sent — copy it or wait.");
    }
    this.#inFlight = true; // includes the entire generation-wait window
    this.#cancelled = false;
    const totalStart = Date.now();
    this.#diagnostics.reset();
    this.#diagnostics.setVerification({ fullStringEquality: false, secondEventSuppressed: false });
    try {
      const readiness = await this.#waitUntilReady(onStatus);
      this.#diagnostics.setTimings({ findInput: Date.now() - totalStart, generationWait: readiness.waitMs });
      this.#diagnostics.setVerification({ stopControlSeen: readiness.stopSeen });
      if (this.#cancelled) return this.#failure(SendResult.SUBMIT_FAILED, "The companion is paused; nothing was sent.");
      if (!readiness.input) {
        return readiness.timedOut
          ? this.#failure(
              SendResult.GENERATION_TIMEOUT,
              "The AI is still generating. Copy the prompt; nothing was sent.",
            )
          : this.#failure(
              SendResult.NO_INPUT,
              "Could not find the chat input box. Copy the prompt and send it manually.",
            );
      }

      const input = readiness.input;
      const typeStart = Date.now();
      const typed = typeIntoWithStrategies(input, prompt);
      this.#diagnostics.setTimings({ type: Date.now() - typeStart });
      this.#diagnostics.setTypingMethod(typed.method);
      const fullMatch = verifyComposerContains(input, prompt);
      this.#diagnostics.setVerification({ fullStringEquality: fullMatch });
      if (!typed.ok || !fullMatch || isComposerEmpty(input)) {
        return this.#failure(
          SendResult.VERIFY_FAILED,
          "The full prompt did not appear in the composer. Copy it instead.",
        );
      }

      // Generation may have begun while typing. Wait again, then recheck the
      // WHOLE prompt: streaming sites can replace the composer while we wait.
      const beforeSubmit = await this.#waitUntilReady(onStatus);
      this.#diagnostics.setTimings({ generationWait: readiness.waitMs + beforeSubmit.waitMs });
      this.#diagnostics.setVerification({ stopControlSeen: readiness.stopSeen || beforeSubmit.stopSeen });
      if (this.#cancelled) return this.#failure(SendResult.SUBMIT_FAILED, "The companion is paused; nothing was sent.");
      if (!beforeSubmit.input || beforeSubmit.timedOut) {
        return this.#failure(
          SendResult.GENERATION_TIMEOUT,
          "The AI is still generating. Copy the prompt; nothing was sent.",
        );
      }
      if (!verifyComposerContains(beforeSubmit.input, prompt)) {
        this.#diagnostics.setVerification({ fullStringEquality: false });
        return this.#failure(SendResult.VERIFY_FAILED, "The full prompt changed before sending. Copy it instead.");
      }

      onStatus("submitting");
      const submitStart = Date.now();
      const method = await this.#submit(beforeSubmit.input, prompt, onSubmit);
      this.#diagnostics.setTimings({ submit: Date.now() - submitStart, total: Date.now() - totalStart });
      if (method) this.#diagnostics.setSubmitMethod(method);
      if (!method) {
        return this.#failure(
          SendResult.SUBMIT_FAILED,
          "Submission could not be confirmed. Copy the prompt; do not retry automatically.",
        );
      }
      return { ok: true, method, error: "", result: SendResult.OK, diagnostics: this.#diagnostics.report };
    } finally {
      this.#inFlight = false;
    }
  }

  async #waitUntilReady(onStatus) {
    const start = Date.now();
    let stopSeen = false;
    let waiting = false;
    for (;;) {
      if (this.#cancelled) return { input: null, waitMs: Date.now() - start, stopSeen, timedOut: false };
      const state = this.findGenerationState();
      stopSeen ||= state.stopSeen;
      const input = this.findInput();
      if (!state.generating && input) {
        if (waiting) onStatus("generation-finished");
        return { input, waitMs: Date.now() - start, stopSeen, timedOut: false };
      }
      if (state.generating && !waiting) {
        onStatus("generation-wait");
        waiting = true;
      }
      const elapsed = Date.now() - start;
      if (elapsed >= (state.generating || waiting ? this.generationWaitMs : this.inputTimeout)) {
        return { input: null, waitMs: elapsed, stopSeen, timedOut: waiting || state.generating };
      }
      await delay(100);
    }
  }

  async #submit(input, prompt, onSubmit) {
    const before = userMessageSnapshot(document, this.#userSelectors);
    const { button } = this.findSendButtonWithDiagnostics(input);
    const state = this.findGenerationState();
    if (this.#cancelled || state.generating) return "";
    if (!verifyComposerContains(input, prompt)) return "";

    if (button) {
      if (!isSendControl(button) || isStopControl(button)) return "";
      this.#diagnostics.setSubmitMethod("button");
      this.#diagnostics.setVerification({ secondEventSuppressed: true });
      try {
        onSubmit();
        button.click();
      } catch (error) {
        // A click can send and then throw. NEVER fall through to Enter.
        log.warn("send button click threw; not resubmitting", error);
        return "";
      }
      return (await this.#confirmed(input, prompt, before)) ? "button" : "";
    }

    // Enter is permitted exactly once, only with a full prompt and no Stop.
    if (this.#cancelled || this.findGenerationState().generating || !verifyComposerContains(input, prompt)) return "";
    this.#diagnostics.setSubmitMethod("enter");
    this.#diagnostics.setVerification({ secondEventSuppressed: true });
    try {
      onSubmit();
      pressEnter(input);
    } catch (error) {
      log.warn("Enter submit failed; not retrying", error);
      return "";
    }
    return (await this.#confirmed(input, prompt, before)) ? "enter" : "";
  }

  async #confirmed(input, prompt, before) {
    const started = Date.now();
    for (;;) {
      const messages = newUserMessages(document, this.#userSelectors, before, prompt);
      if (messages.length > 1) return false;
      const confirmed = messages.length === 1 && collapseWhitespace(textOf(messages[0])) === collapseWhitespace(prompt);
      if (confirmed || isComposerEmpty(input)) {
        await delay(USER_MESSAGE_TIMEOUT_MS);
        const after = newUserMessages(document, this.#userSelectors, before, prompt);
        // A cleared composer is useful confirmation only when no contradicting
        // user message exists. A different user message means the click may
        // have sent something else; never report that as our successful send.
        return after.length === 0
          ? isComposerEmpty(input)
          : after.length === 1 && collapseWhitespace(textOf(after[0])) === collapseWhitespace(prompt);
      }
      if (Date.now() - started >= this.submitSettleMs) return false;
      await delay(80);
    }
  }

  #failure(result, error) {
    log.warn(result, error);
    this.#diagnostics.setError(error);
    return { ok: false, method: "", error, result, diagnostics: this.#diagnostics.report };
  }
}
