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
/** Adaptive waiting polls: fast-start with doubling backoff, capped. */
export const POLL_FAST_START_MS = 40;
export const POLL_MAX_MS = 160;
/**
 * One fast beat so the contradiction/fail-closed check has had its chance
 * before an evidence-based early exit. v0.6 burned a fixed 350ms user-echo
 * timeout plus a recheck chain even when the echo was already visible; the
 * verdict logic (confirmed / contradicted / unconfirmed) is unchanged.
 */
export const CONTRADICTION_BEAT_MS = 40;

export const SendResult = Object.freeze({
  OK: "ok",
  NO_INPUT: "input-missing",
  GENERATION_TIMEOUT: "generation-timeout",
  TYPE_FAILED: "type-failed",
  /** Validation failed before any click/Enter: the system KNOWS nothing was sent. */
  SUBMIT_FAILED: "submit-failed",
  /** One submit event fired, but the host never confirmed delivery. NOT a proof of failure. */
  SUBMIT_UNCONFIRMED: "submit-unconfirmed",
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
  /** True once ONE submit event (click or Enter) may have reached the page. */
  #attemptedSubmit = false;

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
    this.#attemptedSubmit = false;
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
      // "contradicted" = a DIFFERENT new user message appeared while our
      // prompt never did: the transcript proves this prompt did not go out.
      // Fail closed with copy recovery (unlike unconfirmed below).
      if (method === "contradicted") {
        return this.#failure(
          SendResult.SUBMIT_FAILED,
          "The page shows a different new message instead of this prompt. It was not sent — copy it and send it yourself.",
        );
      }
      if (method) {
        this.#diagnostics.setSubmitMethod(method);
        return { ok: true, method, error: "", result: SendResult.OK, diagnostics: this.#diagnostics.report };
      }
      // The submit outcome depends on WHETHER a submit event was dispatched:
      // - never dispatched → we know nothing was sent (copy is safe);
      // - dispatched but unconfirmed → delivery is UNCERTAIN. Claiming
      //   "could not submit" here is exactly the checkmate bug: a host that
      //   renders its user echo late (or transforms the text, or clears the
      //   composer after the settle window) DID receive the one click.
      if (this.#attemptedSubmit) {
        return this.#failure(
          SendResult.SUBMIT_UNCONFIRMED,
          "One send attempt was made but could not be confirmed. Check the pinned chat before copying or sending anything.",
        );
      }
      return this.#failure(
        SendResult.SUBMIT_FAILED,
        "Nothing was submitted — the page accepted no send action. Copy the prompt and send it yourself.",
      );
    } finally {
      this.#inFlight = false;
    }
  }

  async #waitUntilReady(onStatus) {
    const start = Date.now();
    let stopSeen = false;
    let waiting = false;
    let pollMs = POLL_FAST_START_MS;
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
      await delay(pollMs);
      pollMs = Math.min(pollMs * 2, POLL_MAX_MS); // 40 -> 80 -> 160, capped
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
      // From this point on, the page MAY have received our one submit — a
      // later failure to observe confirmation must never be reported as
      // "nothing was sent".
      this.#attemptedSubmit = true;
      this.#diagnostics.markStage("submitted");
      try {
        onSubmit();
        button.click();
      } catch (error) {
        // A click can send and then throw. NEVER fall through to Enter.
        log.warn("send button click threw; not resubmitting", error);
        return "";
      }
      const verdict = await this.#confirmed(input, prompt, before);
      if (verdict === "confirmed") return "button";
      if (verdict === "contradicted") return "contradicted";
      return "";
    }

    // Enter is permitted exactly once, only with a full prompt and no Stop.
    if (this.#cancelled || this.findGenerationState().generating || !verifyComposerContains(input, prompt)) return "";
    this.#diagnostics.setSubmitMethod("enter");
    this.#diagnostics.setVerification({ secondEventSuppressed: true });
    this.#attemptedSubmit = true;
    this.#diagnostics.markStage("submitted");
    try {
      onSubmit();
      pressEnter(input);
    } catch (error) {
      log.warn("Enter submit failed; not retrying", error);
      return "";
    }
    const verdict = await this.#confirmed(input, prompt, before);
    if (verdict === "confirmed") return "enter";
    if (verdict === "contradicted") return "contradicted";
    return "";
  }

  /**
   * Watches the transcript after ONE submit attempt.
   *
   * @returns {Promise<'confirmed'|'contradicted'|'unconfirmed'>} confirmed —
   *   our echo is present (or the composer cleared with no contradiction);
   *   contradicted — a different new user message appeared instead (our
   *   prompt is provably absent); unconfirmed — no evidence either way.
   */
  async #confirmed(input, prompt, before) {
    const started = Date.now();
    // Hosts may REPLACE the composer element while confirming. A stale,
    // detached composer holding the old text must not mask the fresh empty
    // one the site just rendered.
    const composerEmpty = () => {
      const current = input?.isConnected === false ? this.findInput() : input;
      return current ? isComposerEmpty(current) : false;
    };
    const matchesPrompt = (node) => collapseWhitespace(textOf(node)) === collapseWhitespace(prompt);
    let pollMs = POLL_FAST_START_MS;
    for (;;) {
      const messages = newUserMessages(document, this.#userSelectors, before, prompt);
      if (messages.length > 1) return "contradicted";
      const seenPrompt = messages.length === 1 && matchesPrompt(messages[0]);
      if (seenPrompt) this.#diagnostics.markStage("echo-observed");
      if (seenPrompt || composerEmpty()) {
        // Evidence exists — early-exit once the contradiction beat has had its
        // chance. The verdict chain below is byte-for-byte the v0.6 fail-closed
        // logic: a different new user message still proves "not sent".
        await delay(CONTRADICTION_BEAT_MS);
        const after = newUserMessages(document, this.#userSelectors, before, prompt);
        // A cleared composer is useful confirmation only when no contradicting
        // user message exists. A different user message means the transcript
        // does not contain our prompt — fail closed as "not sent".
        if (after.length === 0) {
          const cleared = composerEmpty();
          if (cleared) this.#diagnostics.markStage("echo-observed"); // composer-clear is the user-side confirmation
          return cleared ? "confirmed" : "unconfirmed";
        }
        if (after.length === 1) {
          if (matchesPrompt(after[0])) {
            this.#diagnostics.markStage("echo-observed");
            return "confirmed";
          }
          return "contradicted";
        }
        return "contradicted";
      }
      // No transcript evidence and a non-empty composer: wait out the settle
      // window (late echoes arrive), then report unconfirmed — NOT "failed".
      if (Date.now() - started >= this.submitSettleMs) return "unconfirmed";
      await delay(pollMs);
      pollMs = Math.min(pollMs * 2, POLL_MAX_MS); // 40 -> 80 -> 160, capped
    }
  }

  #failure(result, error) {
    log.warn(result, error);
    this.#diagnostics.setError(error);
    return { ok: false, method: "", error, result, diagnostics: this.#diagnostics.report };
  }
}
