/**
 * Supported AI chat platforms.
 *
 * This module is the single source of truth for every host the extension talks
 * to. `manifest.json` is generated from it (`npm run sync:manifest`), the
 * service worker reads it for the side-panel allow-list, and the content script
 * uses the selector sets to drive each site's composer.
 *
 * When a site changes its DOM, only this file needs updating — see
 * docs/DEVELOPMENT.md.
 *
 * @module shared/platforms
 */

/**
 * @typedef {object} Platform
 * @property {string} id stable identifier used for storage and diagnostics.
 * @property {string} name human-readable name shown in the UI.
 * @property {string[]} hosts hostnames that belong to the platform.
 * @property {string[]} input CSS selectors for the message composer.
 * @property {string[]} send CSS selectors for the submit button.
 * @property {string[]} assistant CSS selectors for AI reply containers.
 * @property {string[]} user CSS selectors for the human's message containers.
 */

/** @type {ReadonlyArray<Platform>} */
export const PLATFORMS = Object.freeze([
  Object.freeze({
    id: "gemini",
    name: "Google Gemini",
    hosts: Object.freeze(["gemini.google.com"]),
    input: Object.freeze([
      "rich-textarea .ql-editor[contenteditable='true']",
      "div.ql-editor[contenteditable='true']",
      "textarea[aria-label*='prompt' i]",
    ]),
    send: Object.freeze(["button.send-button", "button[aria-label*='Send message' i]", "button[aria-label*='Send' i]"]),
    assistant: Object.freeze(["model-response", "message-content", ".model-response-text"]),
    user: Object.freeze(["user-query", ".query-text"]),
  }),
  Object.freeze({
    id: "chatgpt",
    name: "ChatGPT",
    hosts: Object.freeze(["chatgpt.com", "chat.openai.com"]),
    input: Object.freeze(["#prompt-textarea", "div[contenteditable='true'][id='prompt-textarea']", "form textarea"]),
    send: Object.freeze([
      "[data-testid='send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label*='Send' i]",
    ]),
    assistant: Object.freeze([
      "[data-message-author-role='assistant']",
      "div[data-message-author-role='assistant'] .markdown",
      "article[data-testid^='conversation-turn'] .markdown",
    ]),
    user: Object.freeze(["[data-message-author-role='user']", "article[data-testid^='conversation-turn']"]),
  }),
  Object.freeze({
    id: "claude",
    name: "Claude",
    hosts: Object.freeze(["claude.ai"]),
    input: Object.freeze([
      "div.ProseMirror[contenteditable='true']",
      "div[contenteditable='true'][aria-label*='prompt' i]",
      "div[contenteditable='true']",
    ]),
    send: Object.freeze(["button[aria-label='Send message']", "button[aria-label*='Send' i]", "button[type='submit']"]),
    assistant: Object.freeze([
      "[data-testid='conversation-turn'] .font-claude-message",
      ".font-claude-message",
      "[data-is-streaming]",
    ]),
    user: Object.freeze([".font-user-message", "[data-testid='user-message']"]),
  }),
  Object.freeze({
    id: "grok",
    name: "Grok",
    hosts: Object.freeze(["grok.com"]),
    input: Object.freeze(["textarea", "div[contenteditable='true']", "[role='textbox']"]),
    send: Object.freeze(["button[type='submit']", "button[aria-label*='Submit' i]", "button[aria-label*='Send' i]"]),
    assistant: Object.freeze([".message-bubble", "[data-testid='message-bubble']", ".prose"]),
    user: Object.freeze([".items-end .message-bubble", "[data-testid='user-message']"]),
  }),
  Object.freeze({
    id: "perplexity",
    name: "Perplexity",
    hosts: Object.freeze(["www.perplexity.ai", "perplexity.ai"]),
    input: Object.freeze(["textarea#ask-input", "div[contenteditable='true']", "textarea"]),
    send: Object.freeze([
      "button[aria-label*='Submit' i]",
      "button[data-testid='submit-button']",
      "button[type='submit']",
    ]),
    assistant: Object.freeze([".prose", "[data-testid='answer']", ".col-span-12"]),
    user: Object.freeze(["[data-testid='user-message']", ".break-words"]),
  }),
  Object.freeze({
    id: "copilot",
    name: "Microsoft Copilot",
    hosts: Object.freeze(["copilot.microsoft.com"]),
    input: Object.freeze([
      "textarea#userInput",
      "textarea[data-testid='composer-input']",
      "div[contenteditable='true'][role='textbox']",
    ]),
    send: Object.freeze([
      "button[data-testid='submit-button']",
      "button[title*='Submit' i]",
      "button[aria-label*='Submit' i]",
    ]),
    assistant: Object.freeze(["[data-content='ai-message']", ".ai-message-item", "[data-testid='message-bubble']"]),
    user: Object.freeze(["[data-content='user-message']", ".user-message"]),
  }),
]);

/** Generic composer selectors used when a platform-specific one does not match. */
export const GENERIC_INPUT_SELECTORS = Object.freeze(["textarea", "div[contenteditable='true']", "[role='textbox']"]);

/** Generic submit-button selectors, matched by accessible name. */
export const GENERIC_SEND_SELECTORS = Object.freeze([
  "button[data-testid*='send' i]",
  "button[aria-label*='send' i]",
  "button[title*='send' i]",
  "button[aria-label*='submit' i]",
  "button[title*='submit' i]",
  "button[type='submit']",
]);

/** Every hostname the extension is allowed to touch. */
export const SUPPORTED_HOSTS = Object.freeze(PLATFORMS.flatMap((platform) => [...platform.hosts]));

/** Host permission patterns for the manifest, e.g. `https://chatgpt.com/*`. */
export const HOST_PATTERNS = Object.freeze(SUPPORTED_HOSTS.map((host) => `https://${host}/*`));

/**
 * @param {string} hostname
 * @returns {Platform|null} the platform owning `hostname`.
 */
export function platformForHost(hostname) {
  const normalised = String(hostname || "").toLowerCase();
  return PLATFORMS.find((platform) => platform.hosts.includes(normalised)) || null;
}

/**
 * @param {string} url
 * @returns {Platform|null} the platform owning `url`, or null when unsupported.
 */
export function platformForUrl(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return null;
    }
    return platformForHost(parsed.hostname);
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @returns {boolean} true when the URL belongs to a supported AI chat.
 */
export function isSupportedUrl(url) {
  return platformForUrl(url) !== null;
}

/**
 * @param {string} hostname
 * @returns {string[]} composer selectors, platform-specific first.
 */
export function inputSelectorsForHost(hostname) {
  const platform = platformForHost(hostname);
  return [...(platform?.input || []), ...GENERIC_INPUT_SELECTORS];
}

/**
 * @param {string} hostname
 * @returns {string[]} submit-button selectors, platform-specific first.
 */
export function sendSelectorsForHost(hostname) {
  const platform = platformForHost(hostname);
  return [...(platform?.send || []), ...GENERIC_SEND_SELECTORS];
}

/**
 * @param {string} hostname
 * @returns {string[]} selectors for AI reply containers.
 */
export function assistantSelectorsForHost(hostname) {
  return [...(platformForHost(hostname)?.assistant || [])];
}

/**
 * @param {string} hostname
 * @returns {string[]} selectors for the human's own messages.
 */
export function userSelectorsForHost(hostname) {
  return [...(platformForHost(hostname)?.user || [])];
}

/**
 * @returns {string} a comma separated selector list for the current page.
 */
export function currentHostSelectorList(kind, hostname = globalThis.location?.hostname) {
  switch (kind) {
    case "input":
      return inputSelectorsForHost(hostname).join(", ");
    case "send":
      return sendSelectorsForHost(hostname).join(", ");
    case "assistant":
      return assistantSelectorsForHost(hostname).join(", ");
    case "user":
      return userSelectorsForHost(hostname).join(", ");
    default:
      return "";
  }
}
