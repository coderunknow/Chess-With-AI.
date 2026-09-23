/**
 * Supported AI chat platforms — v2 registry.
 *
 * This module is the single source of truth for every host the extension talks
 * to. `manifest.json` is generated from it (`npm run sync:manifest`), the
 * service worker reads it for the side-panel allow-list, and the content script
 * uses the selector sets to drive each site's composer.
 *
 * v0.2.0 changes:
 * - Each role (composer, send, assistant, user, transcript) has an ordered
 *   list of candidates with a strategy hint.
 * - Strategies: textarea, contenteditable, proseMirror, lexical, quill,
 *   aria-label, testid, form-ancestor, generic.
 * - Semantic and structural fallbacks that survive cosmetic redesigns.
 * - Never depends on a single class hash — at least 3 candidates per role.
 *
 * When a site changes its DOM, only this file needs updating — see
 * docs/DEVELOPMENT.md.
 *
 * @module shared/platforms
 */

/**
 * @typedef {object} SelectorCandidate
 * @property {string} selector CSS selector.
 * @property {'textarea'|'contenteditable'|'proseMirror'|'lexical'|'quill'|'aria-label'|'testid'|'form-ancestor'|'role'|'generic'|'semantic'} strategy how to interact.
 * @property {string} [description] human-readable note.
 */

/**
 * @typedef {object} Platform
 * @property {string} id stable identifier used for storage and diagnostics.
 * @property {string} name human-readable name shown in the UI.
 * @property {string[]} hosts hostnames that belong to the platform.
 * @property {string[]} input legacy: CSS selectors for composer (derived).
 * @property {string[]} send legacy: CSS selectors for submit button.
 * @property {string[]} assistant legacy: CSS selectors for AI reply containers.
 * @property {string[]} user legacy: CSS selectors for human messages.
 * @property {SelectorCandidate[]} inputCandidates ordered candidates for composer.
 * @property {SelectorCandidate[]} sendCandidates ordered candidates for send button.
 * @property {SelectorCandidate[]} assistantCandidates ordered candidates for assistant messages.
 * @property {SelectorCandidate[]} userCandidates ordered candidates for user messages.
 * @property {SelectorCandidate[]} transcriptCandidates ordered candidates for transcript root.
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
    inputCandidates: Object.freeze([
      {
        selector: "rich-textarea .ql-editor[contenteditable='true']",
        strategy: "quill",
        description: "Quill editor in rich-textarea",
      },
      { selector: "div.ql-editor[contenteditable='true']", strategy: "quill", description: "Quill editor generic" },
      {
        selector: "div[contenteditable='true'][role='textbox'][aria-label*='prompt' i]",
        strategy: "aria-label",
        description: "Contenteditable with prompt aria-label",
      },
      { selector: "textarea[aria-label*='prompt' i]", strategy: "textarea", description: "Textarea with prompt label" },
      {
        selector: "div[contenteditable='true'][data-lexical-editor='true']",
        strategy: "lexical",
        description: "Lexical editor fallback",
      },
      { selector: "form textarea", strategy: "form-ancestor", description: "Form textarea fallback" },
    ]),
    sendCandidates: Object.freeze([
      { selector: "button.send-button", strategy: "semantic", description: "Legacy send button class" },
      {
        selector: "button[aria-label*='Send message' i]",
        strategy: "aria-label",
        description: "Send message aria-label",
      },
      { selector: "button[data-testid*='send' i]", strategy: "testid", description: "Test id send" },
      { selector: "button[type='submit']", strategy: "form-ancestor", description: "Form submit" },
      { selector: "button[aria-label*='Send' i]", strategy: "aria-label", description: "Generic send label" },
    ]),
    assistantCandidates: Object.freeze([
      { selector: "model-response", strategy: "semantic", description: "Gemini model response element" },
      { selector: "[data-message-author-role='assistant']", strategy: "testid", description: "Role assistant generic" },
      { selector: ".model-response-text", strategy: "generic", description: "Model response text" },
      { selector: "message-content", strategy: "semantic", description: "Message content" },
      { selector: ".markdown", strategy: "generic", description: "Markdown container fallback" },
    ]),
    userCandidates: Object.freeze([
      { selector: "user-query", strategy: "semantic", description: "User query element" },
      { selector: "[data-message-author-role='user']", strategy: "testid", description: "Role user" },
      { selector: ".query-text", strategy: "generic", description: "Query text" },
    ]),
    transcriptCandidates: Object.freeze([
      { selector: "main", strategy: "semantic", description: "Main transcript" },
      { selector: "[role='main']", strategy: "role", description: "Main role" },
      { selector: ".conversation-container", strategy: "generic", description: "Conversation container" },
    ]),
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
    inputCandidates: Object.freeze([
      { selector: "#prompt-textarea", strategy: "testid", description: "Primary prompt textarea id" },
      {
        selector: "div[contenteditable='true'][id='prompt-textarea']",
        strategy: "contenteditable",
        description: "Contenteditable with prompt id",
      },
      {
        selector: "form textarea[data-testid='composer-input']",
        strategy: "testid",
        description: "Composer input testid",
      },
      {
        selector: "textarea[aria-label*='prompt' i]",
        strategy: "aria-label",
        description: "Textarea aria-label prompt",
      },
      { selector: "div[contenteditable='true'][role='textbox']", strategy: "role", description: "Role textbox" },
      { selector: "form textarea", strategy: "form-ancestor", description: "Form textarea fallback" },
    ]),
    sendCandidates: Object.freeze([
      { selector: "[data-testid='send-button']", strategy: "testid", description: "Send button testid" },
      { selector: "button[aria-label='Send prompt']", strategy: "aria-label", description: "Send prompt label" },
      { selector: "button[data-testid*='composer-send']", strategy: "testid", description: "Composer send" },
      { selector: "form button[type='submit']", strategy: "form-ancestor", description: "Form submit" },
      { selector: "button[aria-label*='Send' i]", strategy: "aria-label", description: "Generic send" },
    ]),
    assistantCandidates: Object.freeze([
      { selector: "[data-message-author-role='assistant']", strategy: "testid", description: "Assistant role" },
      {
        selector: "div[data-message-author-role='assistant'] .markdown",
        strategy: "semantic",
        description: "Assistant markdown",
      },
      {
        selector: "article[data-testid^='conversation-turn'] .markdown",
        strategy: "testid",
        description: "Conversation turn markdown",
      },
      { selector: "article", strategy: "semantic", description: "Article fallback" },
      { selector: ".prose", strategy: "generic", description: "Prose fallback" },
    ]),
    userCandidates: Object.freeze([
      { selector: "[data-message-author-role='user']", strategy: "testid", description: "User role" },
      { selector: "article[data-testid^='conversation-turn']", strategy: "testid", description: "Conversation turn" },
      { selector: "[data-testid='user-message']", strategy: "testid", description: "User message testid" },
    ]),
    transcriptCandidates: Object.freeze([
      { selector: "main", strategy: "semantic", description: "Main" },
      { selector: "[role='main']", strategy: "role", description: "Main role" },
      { selector: "[data-testid='conversation']", strategy: "testid", description: "Conversation testid" },
    ]),
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
    inputCandidates: Object.freeze([
      {
        selector: "div.ProseMirror[contenteditable='true']",
        strategy: "proseMirror",
        description: "ProseMirror editor",
      },
      {
        selector: "div[contenteditable='true'][aria-label*='prompt' i]",
        strategy: "aria-label",
        description: "Prompt aria-label",
      },
      { selector: "div[contenteditable='true'][role='textbox']", strategy: "role", description: "Role textbox" },
      {
        selector: "div[contenteditable='true'][data-lexical-editor='true']",
        strategy: "lexical",
        description: "Lexical fallback",
      },
      { selector: "div[contenteditable='true']", strategy: "contenteditable", description: "Generic contenteditable" },
    ]),
    sendCandidates: Object.freeze([
      { selector: "button[aria-label='Send message']", strategy: "aria-label", description: "Send message label" },
      { selector: "button[data-testid*='send' i]", strategy: "testid", description: "Send testid" },
      { selector: "button[type='submit']", strategy: "form-ancestor", description: "Form submit" },
      { selector: "button[aria-label*='Send' i]", strategy: "aria-label", description: "Generic send" },
    ]),
    assistantCandidates: Object.freeze([
      {
        selector: "[data-testid='conversation-turn'] .font-claude-message",
        strategy: "testid",
        description: "Claude message",
      },
      { selector: ".font-claude-message", strategy: "generic", description: "Font claude message" },
      { selector: "[data-is-streaming]", strategy: "testid", description: "Streaming indicator" },
      {
        selector: "[data-message-author-role='assistant']",
        strategy: "testid",
        description: "Assistant role fallback",
      },
      { selector: "article", strategy: "semantic", description: "Article fallback" },
    ]),
    userCandidates: Object.freeze([
      { selector: ".font-user-message", strategy: "generic", description: "User message font" },
      { selector: "[data-testid='user-message']", strategy: "testid", description: "User message testid" },
      { selector: "[data-message-author-role='user']", strategy: "testid", description: "User role" },
    ]),
    transcriptCandidates: Object.freeze([
      { selector: "main", strategy: "semantic", description: "Main" },
      { selector: "[role='main']", strategy: "role", description: "Main role" },
      { selector: ".conversation", strategy: "generic", description: "Conversation" },
    ]),
  }),
  Object.freeze({
    id: "grok",
    name: "Grok",
    hosts: Object.freeze(["grok.com"]),
    input: Object.freeze(["textarea", "div[contenteditable='true']", "[role='textbox']"]),
    send: Object.freeze(["button[type='submit']", "button[aria-label*='Submit' i]", "button[aria-label*='Send' i]"]),
    assistant: Object.freeze([".message-bubble", "[data-testid='message-bubble']", ".prose"]),
    user: Object.freeze([".items-end .message-bubble", "[data-testid='user-message']"]),
    inputCandidates: Object.freeze([
      { selector: "textarea[aria-label*='prompt' i]", strategy: "aria-label", description: "Textarea prompt" },
      { selector: "textarea[data-testid='composer-input']", strategy: "testid", description: "Composer input" },
      { selector: "div[contenteditable='true'][role='textbox']", strategy: "role", description: "Role textbox" },
      { selector: "textarea", strategy: "textarea", description: "Generic textarea" },
      { selector: "div[contenteditable='true']", strategy: "contenteditable", description: "Generic contenteditable" },
      { selector: "[role='textbox']", strategy: "role", description: "Role textbox generic" },
    ]),
    sendCandidates: Object.freeze([
      { selector: "button[type='submit']", strategy: "form-ancestor", description: "Submit type" },
      { selector: "button[data-testid*='send' i]", strategy: "testid", description: "Send testid" },
      { selector: "button[aria-label*='Submit' i]", strategy: "aria-label", description: "Submit label" },
      { selector: "button[aria-label*='Send' i]", strategy: "aria-label", description: "Send label" },
    ]),
    assistantCandidates: Object.freeze([
      { selector: ".message-bubble", strategy: "generic", description: "Message bubble" },
      { selector: "[data-testid='message-bubble']", strategy: "testid", description: "Message bubble testid" },
      { selector: "[data-message-author-role='assistant']", strategy: "testid", description: "Assistant role" },
      { selector: ".prose", strategy: "generic", description: "Prose fallback" },
      { selector: "article", strategy: "semantic", description: "Article" },
    ]),
    userCandidates: Object.freeze([
      { selector: ".items-end .message-bubble", strategy: "generic", description: "User bubble aligned end" },
      { selector: "[data-testid='user-message']", strategy: "testid", description: "User message testid" },
      { selector: "[data-message-author-role='user']", strategy: "testid", description: "User role" },
    ]),
    transcriptCandidates: Object.freeze([
      { selector: "main", strategy: "semantic", description: "Main" },
      { selector: "[role='main']", strategy: "role", description: "Main role" },
      { selector: ".messages", strategy: "generic", description: "Messages container" },
    ]),
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
    inputCandidates: Object.freeze([
      { selector: "textarea#ask-input", strategy: "testid", description: "Ask input id" },
      { selector: "textarea[aria-label*='Ask' i]", strategy: "aria-label", description: "Ask aria-label" },
      { selector: "div[contenteditable='true'][role='textbox']", strategy: "role", description: "Role textbox" },
      { selector: "div[contenteditable='true']", strategy: "contenteditable", description: "Generic contenteditable" },
      { selector: "textarea", strategy: "textarea", description: "Generic textarea" },
    ]),
    sendCandidates: Object.freeze([
      { selector: "button[aria-label*='Submit' i]", strategy: "aria-label", description: "Submit label" },
      { selector: "button[data-testid='submit-button']", strategy: "testid", description: "Submit testid" },
      { selector: "button[type='submit']", strategy: "form-ancestor", description: "Form submit" },
      { selector: "button[aria-label*='Send' i]", strategy: "aria-label", description: "Send label fallback" },
    ]),
    assistantCandidates: Object.freeze([
      { selector: ".prose", strategy: "generic", description: "Prose" },
      { selector: "[data-testid='answer']", strategy: "testid", description: "Answer testid" },
      { selector: "[data-message-author-role='assistant']", strategy: "testid", description: "Assistant role" },
      { selector: ".col-span-12", strategy: "generic", description: "Column span" },
      { selector: "article", strategy: "semantic", description: "Article fallback" },
    ]),
    userCandidates: Object.freeze([
      { selector: "[data-testid='user-message']", strategy: "testid", description: "User message" },
      { selector: ".break-words", strategy: "generic", description: "Break words" },
      { selector: "[data-message-author-role='user']", strategy: "testid", description: "User role" },
    ]),
    transcriptCandidates: Object.freeze([
      { selector: "main", strategy: "semantic", description: "Main" },
      { selector: "[role='main']", strategy: "role", description: "Main role" },
      { selector: ".answers", strategy: "generic", description: "Answers container" },
    ]),
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
    inputCandidates: Object.freeze([
      { selector: "textarea#userInput", strategy: "testid", description: "User input id" },
      { selector: "textarea[data-testid='composer-input']", strategy: "testid", description: "Composer input testid" },
      { selector: "textarea[aria-label*='prompt' i]", strategy: "aria-label", description: "Prompt aria-label" },
      { selector: "div[contenteditable='true'][role='textbox']", strategy: "role", description: "Role textbox" },
      { selector: "div[contenteditable='true']", strategy: "contenteditable", description: "Generic contenteditable" },
    ]),
    sendCandidates: Object.freeze([
      { selector: "button[data-testid='submit-button']", strategy: "testid", description: "Submit testid" },
      { selector: "button[title*='Submit' i]", strategy: "aria-label", description: "Submit title" },
      { selector: "button[aria-label*='Submit' i]", strategy: "aria-label", description: "Submit aria-label" },
      { selector: "button[type='submit']", strategy: "form-ancestor", description: "Form submit" },
    ]),
    assistantCandidates: Object.freeze([
      { selector: "[data-content='ai-message']", strategy: "testid", description: "AI message data-content" },
      { selector: ".ai-message-item", strategy: "generic", description: "AI message item" },
      { selector: "[data-testid='message-bubble']", strategy: "testid", description: "Message bubble" },
      { selector: "[data-message-author-role='assistant']", strategy: "testid", description: "Assistant role" },
      { selector: ".prose", strategy: "generic", description: "Prose fallback" },
    ]),
    userCandidates: Object.freeze([
      { selector: "[data-content='user-message']", strategy: "testid", description: "User message data-content" },
      { selector: ".user-message", strategy: "generic", description: "User message class" },
      { selector: "[data-message-author-role='user']", strategy: "testid", description: "User role" },
    ]),
    transcriptCandidates: Object.freeze([
      { selector: "main", strategy: "semantic", description: "Main" },
      { selector: "[role='main']", strategy: "role", description: "Main role" },
      { selector: ".chat-container", strategy: "generic", description: "Chat container" },
    ]),
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
 * @param {string} hostname
 * @returns {SelectorCandidate[]} composer candidates with strategies.
 */
export function inputCandidatesForHost(hostname) {
  const platform = platformForHost(hostname);
  const generic = GENERIC_INPUT_SELECTORS.map((selector) => ({
    selector,
    strategy: "generic",
    description: "Generic fallback",
  }));
  return [...(platform?.inputCandidates || []), ...generic];
}

/**
 * @param {string} hostname
 * @returns {SelectorCandidate[]} send button candidates.
 */
export function sendCandidatesForHost(hostname) {
  const platform = platformForHost(hostname);
  const generic = GENERIC_SEND_SELECTORS.map((selector) => ({
    selector,
    strategy: "generic",
    description: "Generic fallback",
  }));
  return [...(platform?.sendCandidates || []), ...generic];
}

/**
 * @param {string} hostname
 * @returns {SelectorCandidate[]} assistant candidates.
 */
export function assistantCandidatesForHost(hostname) {
  return [...(platformForHost(hostname)?.assistantCandidates || [])];
}

/**
 * @param {string} hostname
 * @returns {SelectorCandidate[]} user candidates.
 */
export function userCandidatesForHost(hostname) {
  return [...(platformForHost(hostname)?.userCandidates || [])];
}

/**
 * @param {string} hostname
 * @returns {SelectorCandidate[]} transcript candidates.
 */
export function transcriptCandidatesForHost(hostname) {
  return [...(platformForHost(hostname)?.transcriptCandidates || [])];
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
