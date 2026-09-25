/**
 * Diagnostics collection for the AI-host bridge.
 *
 * Pure, DOM-free. The content script populates it, the side panel renders it.
 * No automatic upload, ever — only a "copy report" button.
 *
 * @module shared/diagnostics
 */

/**
 * @typedef {object} SelectorAttempt
 * @property {string} selector
 * @property {string} strategy e.g. 'textarea', 'contenteditable', 'proseMirror'
 * @property {boolean} matched
 * @property {number} timeMs
 */

/**
 * @typedef {object} DiagnosticsReport
 * @property {string} platform id, e.g. 'chatgpt'
 * @property {string} url
 * @property {string} timestamp ISO string
 * @property {SelectorAttempt[]} composerAttempts
 * @property {SelectorAttempt[]} sendAttempts
 * @property {SelectorAttempt[]} assistantAttempts
 * @property {{findInput:number, type:number, submit:number, total:number, generationWait:number}} timings
 * @property {{stopControlSeen:boolean, secondEventSuppressed:boolean, fullStringEquality:boolean}} verification
 * @property {string} lastError
 * @property {string} matchedComposer
 * @property {string} matchedSend
 * @property {string} matchedAssistant
 * @property {string} typingMethod
 * @property {string} submitMethod
 * @property {Record<string, number>} stages privacy-safe stage timestamps (latency timeline).
 * @property {ReplyPath} reply privacy-safe reply-path codes (v0.7.2).
 */

/**
 * Reply-path codes: what happened to the assistant's answer on the content
 * side. Codes and counters only — never message text, FENs or titles.
 *
 * @typedef {object} ReplyPath
 * @property {''|'confirmed'|'echo'|'reply'|'manual'} attribution how the reply was tied to the request.
 * @property {''|'move'|'no-move'|'repeated'|'resigned'} outcome the verdict handed to the panel.
 * @property {number} echoSkipped containers skipped because they were our own prompt.
 * @property {boolean} refilled the answer arrived in a pre-existing (placeholder / re-used) container.
 */

/**
 * Creates an empty report.
 *
 * @param {object} [options]
 * @param {string} [options.platform]
 * @param {string} [options.url]
 * @returns {DiagnosticsReport}
 */
export function createEmptyReport({ platform = "", url = "" } = {}) {
  return {
    platform,
    url,
    timestamp: new Date().toISOString(),
    composerAttempts: [],
    sendAttempts: [],
    assistantAttempts: [],
    timings: { findInput: 0, type: 0, submit: 0, total: 0, generationWait: 0 },
    verification: { stopControlSeen: false, secondEventSuppressed: false, fullStringEquality: false },
    lastError: "",
    matchedComposer: "",
    matchedSend: "",
    matchedAssistant: "",
    typingMethod: "",
    submitMethod: "",
    stages: {},
    reply: { attribution: "", outcome: "", echoSkipped: 0, refilled: false },
  };
}

/**
 * Formats a report as human-readable text for clipboard.
 *
 * @param {DiagnosticsReport} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [
    `AI Chess Companion Diagnostics`,
    `Platform: ${report.platform || "unknown"}`,
    `URL: ${report.url || "unknown"}`,
    `Time: ${report.timestamp}`,
    ``,
    `Matched composer: ${report.matchedComposer || "none"}`,
    `Matched send: ${report.matchedSend || "none"}`,
    `Matched assistant: ${report.matchedAssistant || "none"}`,
    `Typing method: ${report.typingMethod || "none"}`,
    `Submit method: ${report.submitMethod || "none"}`,
    ``,
    `Timings (ms): findInput=${report.timings.findInput} generationWait=${report.timings.generationWait} type=${report.timings.type} submit=${report.timings.submit} total=${report.timings.total}`,
    `Stop seen: ${Boolean(report.verification?.stopControlSeen)}; submit: ${report.submitMethod || "none"}; second event suppressed: ${Boolean(report.verification?.secondEventSuppressed)}; full-string equality: ${Boolean(report.verification?.fullStringEquality)}`,
    `Stage timestamps (epoch ms, no content): ${
      Object.entries(report.stages || {})
        .map(([stage, at]) => `${stage}=${at}`)
        .join(" ") || "none"
    }`,
    `Reply path: attribution=${report.reply?.attribution || "none"} outcome=${report.reply?.outcome || "none"} echo-skipped=${Number(report.reply?.echoSkipped) || 0} refilled=${Boolean(report.reply?.refilled)}`,
    ``,
  ];

  if (report.lastError) {
    lines.push(`Last error: ${report.lastError}`, ``);
  }

  const formatAttempts = (label, attempts) => {
    lines.push(`${label}:`);
    if (attempts.length === 0) {
      lines.push(`  (none)`);
    } else {
      for (const attempt of attempts.slice(-10)) {
        lines.push(`  ${attempt.matched ? "✓" : "✗"} ${attempt.selector} [${attempt.strategy}] ${attempt.timeMs}ms`);
      }
    }
    lines.push(``);
  };

  formatAttempts("Composer attempts", report.composerAttempts);
  formatAttempts("Send attempts", report.sendAttempts);
  formatAttempts("Assistant attempts", report.assistantAttempts);

  return lines.join("\n");
}

/**
 * Simple in-memory collector used by the content script.
 */
export class DiagnosticsCollector {
  /** @type {DiagnosticsReport} */
  #report;

  /**
   * @param {object} [options]
   * @param {string} [options.platform]
   * @param {string} [options.url]
   */
  constructor({ platform = "", url = "" } = {}) {
    this.#report = createEmptyReport({ platform, url });
  }

  /** @returns {DiagnosticsReport} */
  get report() {
    return { ...this.#report, timestamp: new Date().toISOString() };
  }

  /**
   * @param {string} role 'composer'|'send'|'assistant'
   * @param {SelectorAttempt} attempt
   */
  addAttempt(role, attempt) {
    const key = role === "composer" ? "composerAttempts" : role === "send" ? "sendAttempts" : "assistantAttempts";
    this.#report[key].push(attempt);
    if (this.#report[key].length > 20) {
      this.#report[key].shift();
    }
    if (attempt.matched) {
      if (role === "composer") this.#report.matchedComposer = attempt.selector;
      if (role === "send") this.#report.matchedSend = attempt.selector;
      if (role === "assistant") this.#report.matchedAssistant = attempt.selector;
    }
  }

  /** @param {Partial<DiagnosticsReport['timings']>} timings */
  setTimings(timings) {
    this.#report.timings = { ...this.#report.timings, ...timings };
  }

  /** @param {Partial<DiagnosticsReport['verification']>} fields */
  setVerification(fields) {
    this.#report.verification = { ...this.#report.verification, ...fields };
  }

  /** @param {string} error */
  setError(error) {
    this.#report.lastError = String(error).slice(0, 500);
  }

  /** @param {string} method */
  setTypingMethod(method) {
    this.#report.typingMethod = method;
  }

  /** @param {string} method */
  setSubmitMethod(method) {
    this.#report.submitMethod = method;
  }

  /**
   * Records the first observation of a latency stage (numbers only). Late
   * duplicates never rewrite the original observation.
   *
   * @param {string} stage one of `src/shared/latency.js` stage names.
   * @param {number} [at] epoch ms.
   */
  markStage(stage, at = Date.now()) {
    if (typeof at !== "number" || !Number.isFinite(at)) return;
    if (Object.hasOwn(this.#report.stages, stage)) return;
    this.#report.stages[stage] = at;
  }

  /**
   * Merges reply-path codes. Replace-on-write, so a report snapshot already
   * handed to the panel never changes underneath it.
   *
   * @param {Partial<ReplyPath>} fields
   */
  setReply(fields) {
    this.#report.reply = { ...this.#report.reply, ...fields };
  }

  /** @param {string} platform */
  setPlatform(platform) {
    this.#report.platform = platform;
  }

  /** @param {string} url */
  setUrl(url) {
    this.#report.url = url;
  }

  reset() {
    const platform = this.#report.platform;
    const url = this.#report.url;
    this.#report = createEmptyReport({ platform, url });
  }
}
