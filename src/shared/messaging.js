/**
 * Message contract shared by the service worker, the content scripts and the
 * side panel.
 *
 * Every runtime message is a plain object with a `type` field taken from
 * {@link MessageType}. Payloads are validated before use so that a compromised
 * or buggy sender cannot push malformed data into the engine.
 *
 * @module shared/messaging
 */

/** Runtime message types. */
export const MessageType = Object.freeze({
  /** Side panel -> service worker: which tab should receive chess prompts? */
  GET_ACTIVE_TAB: "GET_ACTIVE_TAB",
  /** Service worker -> side panel: the active tab changed. */
  ACTIVE_TAB_CHANGED: "ACTIVE_TAB_CHANGED",
  /** Side panel -> content script: type this prompt and submit it. */
  SEND_CHESS_PROMPT: "SEND_CHESS_PROMPT",
  /** Content script -> side panel: the AI produced a move. */
  AI_MOVE: "AI_MOVE",
  /** Content script -> side panel: lifecycle notice (loaded, error, ...). */
  CONTENT_STATUS: "CONTENT_STATUS",
  /** Liveness probe used by the side panel before injecting the script. */
  PING: "PING",
});

/** Longest prompt the extension will type into a chat box. */
export const MAX_PROMPT_LENGTH = 4000;

/** Hard limit for text scanned for a move, to bound the MutationObserver cost. */
export const MAX_SCANNED_TEXT_LENGTH = 20000;

/**
 * Control characters are replaced with spaces before a prompt is typed into a
 * chat box. Built from character codes on purpose: writing the range literally
 * trips `no-control-regex`, and a prompt pasted from a terminal can contain them.
 */
const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

const TYPES = new Set(Object.values(MessageType));

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is a plain object.
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} message
 * @returns {boolean} true when `message` is a runtime message this extension understands.
 */
export function isExtensionMessage(message) {
  return isRecord(message) && typeof message.type === "string" && TYPES.has(message.type);
}

/**
 * @param {string} type one of {@link MessageType}.
 * @param {Record<string, unknown>} [payload]
 * @returns {{type: string}} a message object.
 */
export function createMessage(type, payload = {}) {
  return { type, ...payload };
}

/**
 * Trims and bounds a prompt so a runaway string can never be typed into a chat box.
 *
 * @param {unknown} value
 * @returns {string} a safe prompt, or `''` when the input is not usable.
 */
export function sanitisePrompt(value) {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.replace(CONTROL_CHARACTERS, " ").trim();
  return text.length > MAX_PROMPT_LENGTH ? text.slice(0, MAX_PROMPT_LENGTH) : text;
}

/**
 * @param {unknown} value
 * @returns {{ok: boolean, error: string}} a normalised response envelope.
 */
export function normaliseResponse(value) {
  if (!isRecord(value)) {
    return { ok: false, error: "The AI tab did not answer." };
  }
  if (value.ok === true) {
    return { ok: true, error: "", method: typeof value.method === "string" ? value.method : "" };
  }
  return {
    ok: false,
    error: typeof value.error === "string" && value.error ? value.error : "The request failed.",
  };
}

/**
 * Wraps `chrome.runtime.lastError` handling for callback-style messaging.
 *
 * @param {unknown} error `chrome.runtime.lastError`.
 * @returns {string} a readable description, or `''`.
 */
export function describeRuntimeError(error) {
  if (!error) {
    return "";
  }
  return typeof error === "string" ? error : error.message || "Unknown extension error.";
}
