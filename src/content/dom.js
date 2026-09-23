/**
 * DOM helpers for the content script — v2.
 *
 * These utilities deal with the realities of modern chat UIs: virtualised
 * React lists, contenteditable editors (ProseMirror, Quill, Lexical) and buttons
 * that only react to synthetic events with the right flags.
 *
 * v0.2.0 adds:
 * - Ordered typing strategies with read-back verification
 * - Framework-specific paths for ProseMirror/Lexical/Quill
 * - Submit with confirmation (button → Enter → requestSubmit)
 * - User message appearance detection
 * - SAN normalization helpers (figurine unicode, 0-0/O-O, annotations)
 *
 * @module content/dom
 */

import { createLogger } from "../shared/log.js";

const log = createLogger("dom");

/** Text above this length is truncated before scanning. */
export const MAX_TEXT_LENGTH = 20000;

/**
 * @param {unknown} element
 * @returns {element is Element} true when the value is an element.
 */
export function isElement(element) {
  return typeof Element !== "undefined" && element instanceof Element;
}

/**
 * @param {unknown} element
 * @returns {boolean} true when the element is rendered and takes space.
 */
export function isVisible(element) {
  if (!isElement(element)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }
  if (Number(style.opacity) === 0) {
    return false;
  }
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * @param {unknown} element
 * @returns {boolean} true when the element accepts typed text.
 */
export function isEditable(element) {
  if (!isElement(element) || !isVisible(element)) {
    return false;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly;
  }
  if (!(element instanceof HTMLElement) || !element.isContentEditable) {
    return false;
  }
  return element.getAttribute("aria-disabled") !== "true";
}

/**
 * @param {Element} element
 * @returns {boolean} true when the element belongs to the composer or to the
 *   human's own message, i.e. never an AI reply.
 */
export function isUserSideElement(element) {
  if (!isElement(element)) {
    return false;
  }
  return Boolean(
    element.closest(
      "textarea, input, form, [contenteditable='true'], [data-message-author-role='user'], [data-content='user-message'], .font-user-message",
    ),
  );
}

/**
 * Returns the first visible element matching any selector, searching each
 * selector in order so platform-specific selectors win over generic ones.
 *
 * @param {ParentNode} root
 * @param {ReadonlyArray<string>|ReadonlyArray<{selector:string}>} selectors
 * @param {(element: Element) => boolean} [predicate]
 * @returns {Element|null} the matched element.
 */
export function findFirst(root, selectors, predicate = () => true) {
  for (const entry of selectors) {
    const selector = typeof entry === "string" ? entry : entry.selector;
    let matches;
    try {
      matches = root.querySelectorAll(selector);
    } catch (error) {
      log.debug(`skipping invalid selector "${selector}"`, error);
      continue;
    }
    for (const element of matches) {
      if (predicate(element)) {
        return element;
      }
    }
  }
  return null;
}

/**
 * Finds all visible elements matching selectors in order, with timing.
 *
 * @param {ParentNode} root
 * @param {ReadonlyArray<{selector:string, strategy:string}>} candidates
 * @param {(element:Element)=>boolean} predicate
 * @returns {{element:Element|null, attempts:Array<{selector:string,strategy:string,matched:boolean,timeMs:number}>}}
 */
export function findFirstWithDiagnostics(root, candidates, predicate = () => true) {
  const attempts = [];
  for (const candidate of candidates) {
    const start = Date.now();
    let matched = false;
    let element = null;
    try {
      const matches = root.querySelectorAll(candidate.selector);
      for (const el of matches) {
        if (predicate(el)) {
          element = el;
          matched = true;
          break;
        }
      }
    } catch (error) {
      log.debug(`invalid selector "${candidate.selector}"`, error);
    }
    const timeMs = Date.now() - start;
    attempts.push({ selector: candidate.selector, strategy: candidate.strategy, matched, timeMs });
    if (element) {
      return { element, attempts };
    }
  }
  return { element: null, attempts };
}

/**
 * @param {Element} element
 * @returns {number} the bottom edge used to identify the bottom-most composer.
 */
export function bottomOf(element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom;
}

/**
 * Polls `find` until it returns a truthy value or the timeout elapses.
 *
 * @template T
 * @param {() => T} find
 * @param {object} [options]
 * @param {number} [options.timeout] milliseconds, default 5000.
 * @param {number} [options.interval] milliseconds, default 100.
 * @returns {Promise<T|null>} the first truthy result.
 */
export function waitFor(find, { timeout = 5000, interval = 100 } = {}) {
  const immediate = find();
  if (immediate) {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const found = find();
      if (found || Date.now() - startedAt >= timeout) {
        window.clearInterval(timer);
        resolve(found || null);
      }
    }, interval);
  });
}

/**
 * Sets a value on a React-controlled input using the native setter, which is
 * what makes frameworks notice the change.
 *
 * @param {HTMLInputElement|HTMLTextAreaElement} element
 * @param {string} value
 */
export function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

/**
 * @param {Element} element
 * @param {unknown} data
 */
export function dispatchInputEvent(element, data) {
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: String(data ?? "") }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Focuses the element and places the caret at the end of its content.
 *
 * @param {HTMLElement} element
 */
export function focusAtEnd(element) {
  element.focus({ preventScroll: true });
  if (!element.isContentEditable) {
    if (typeof element.setSelectionRange === "function") {
      const length = /** @type {HTMLInputElement} */ (element).value?.length ?? 0;
      try {
        element.setSelectionRange(length, length);
      } catch {
        // Some input types (email, number) do not support selection ranges.
      }
    }
    return;
  }

  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Reads back the current text from a composer.
 *
 * @param {HTMLElement} element
 * @returns {string}
 */
export function readComposer(element) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }
  return element.textContent || element.innerText || "";
}

/**
 * Types `value` into a composer using multiple strategies, verifying read-back.
 *
 * Strategies tried in order:
 * 1. execCommand("insertText")
 * 2. Native value setter + input/change
 * 3. InputEvent with inputType insertText
 * 4. Framework-specific: ProseMirror (set textContent inside), Quill (.ql-editor), Lexical
 *
 * @param {HTMLElement} element
 * @param {string} value
 * @returns {{ok:boolean, method:string}} true when text is present afterwards.
 */
export function typeInto(element, value) {
  const result = typeIntoWithStrategies(element, value);
  return result.ok;
}

/**
 * Same as typeInto but returns method used.
 *
 * @param {HTMLElement} element
 * @param {string} value
 * @returns {{ok:boolean, method:string}}
 */
export function typeIntoWithStrategies(element, value) {
  const startText = readComposer(element);
  focusAtEnd(element);

  // Strategy 1: execCommand
  try {
    const inserted = document.execCommand("insertText", false, value);
    const after = readComposer(element);
    if (inserted && after.includes(value.slice(0, Math.min(20, value.length)))) {
      dispatchInputEvent(element, value);
      if (verifyComposerContains(element, value)) {
        return { ok: true, method: "execCommand" };
      }
    }
  } catch (error) {
    log.debug("execCommand insertText failed", error);
  }

  // Strategy 2: native setter for textarea/input
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    try {
      setNativeValue(element, value);
      dispatchInputEvent(element, value);
      if (verifyComposerContains(element, value)) {
        return { ok: true, method: "nativeSetter" };
      }
    } catch (error) {
      log.debug("native setter failed", error);
    }
  }

  // Strategy 3: InputEvent with inputType
  try {
    const beforeInput =
      typeof globalThis.InputEvent === "function"
        ? new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: value })
        : new Event("beforeinput", { bubbles: true, cancelable: true });
    element.dispatchEvent(beforeInput);
    const inputEvent = new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: value,
    });
    element.dispatchEvent(inputEvent);
    if (verifyComposerContains(element, value)) {
      return { ok: true, method: "inputEvent" };
    }
  } catch (error) {
    log.debug("InputEvent strategy failed", error);
  }

  // Strategy 4: framework-specific — ProseMirror
  try {
    const proseMirror = element.matches(".ProseMirror") ? element : element.querySelector(".ProseMirror");
    if (proseMirror) {
      proseMirror.textContent = value;
      proseMirror.dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }),
      );
      if (verifyComposerContains(proseMirror, value) || verifyComposerContains(element, value)) {
        return { ok: true, method: "proseMirror" };
      }
    }
  } catch (error) {
    log.debug("ProseMirror strategy failed", error);
  }

  // Strategy 5: Quill
  try {
    const quillEditor = element.matches(".ql-editor") ? element : element.querySelector(".ql-editor");
    if (quillEditor) {
      quillEditor.textContent = value;
      quillEditor.dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }),
      );
      if (verifyComposerContains(quillEditor, value) || verifyComposerContains(element, value)) {
        return { ok: true, method: "quill" };
      }
    }
  } catch (error) {
    log.debug("Quill strategy failed", error);
  }

  // Strategy 6: Lexical
  try {
    const lexical =
      element.querySelector("[data-lexical-editor='true']") ||
      (element.getAttribute("data-lexical-editor") === "true" ? element : null);
    if (lexical) {
      lexical.textContent = value;
      lexical.dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }),
      );
      if (verifyComposerContains(lexical, value) || verifyComposerContains(element, value)) {
        return { ok: true, method: "lexical" };
      }
    }
  } catch (error) {
    log.debug("Lexical strategy failed", error);
  }

  // Final fallback: direct textContent assignment
  try {
    if (element.isContentEditable) {
      element.textContent = value;
      dispatchInputEvent(element, value);
      if (verifyComposerContains(element, value)) {
        return { ok: true, method: "textContentFallback" };
      }
    }
  } catch (error) {
    log.debug("textContent fallback failed", error);
  }

  // Restore original if all failed? No, keep what we have for diagnostics
  log.debug(
    `all typing strategies failed, start="${startText.slice(0, 20)}" current="${readComposer(element).slice(0, 20)}"`,
  );
  return {
    ok: verifyComposerContains(element, value),
    method: verifyComposerContains(element, value) ? "fallbackVerified" : "",
  };
}

/**
 * @param {HTMLElement} element
 * @param {string} value
 * @returns {boolean} true when composer contains value (or significant prefix)
 */
export function verifyComposerContains(element, value) {
  const current = readComposer(element);
  if (!current) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Check for at least first 20 chars or 50% of prompt
  const probe = trimmed.slice(0, Math.min(30, trimmed.length));
  return current.includes(probe) || current.trim().length >= trimmed.length * 0.8;
}

/**
 * @param {HTMLElement} element
 * @returns {boolean} true when the composer is empty.
 */
export function isComposerEmpty(element) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value.trim() === "";
  }
  return (element.textContent || "").trim() === "";
}

/**
 * Dispatches the full Enter key sequence, which many composers require.
 *
 * @param {HTMLElement} element
 */
export function pressEnter(element) {
  const base = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  for (const type of ["keydown", "keypress", "keyup"]) {
    element.dispatchEvent(new KeyboardEvent(type, base));
  }
}

/**
 * Attempts to submit via form.requestSubmit() if available.
 *
 * @param {HTMLElement} input
 * @returns {boolean} true when requestSubmit was called.
 */
export function tryRequestSubmit(input) {
  try {
    const form = input.closest("form");
    if (form && typeof form.requestSubmit === "function") {
      const submitter = form.querySelector("button[type='submit']");
      if (submitter) {
        form.requestSubmit(submitter);
      } else {
        form.requestSubmit();
      }
      return true;
    }
  } catch (error) {
    log.debug("requestSubmit failed", error);
  }
  return false;
}

/**
 * @param {Element} element
 * @returns {string} visible text, truncated to {@link MAX_TEXT_LENGTH}.
 */
export function textOf(element) {
  if (!isElement(element)) {
    return "";
  }
  const text = (element.innerText || element.textContent || "").trim();
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
}

/**
 * Normalizes AI reply text for move extraction: handles figurine unicode,
 * 0-0/O-O, e8=Q+, annotations, numbered lists, etc.
 *
 * @param {string} text
 * @returns {string} normalized text
 */
export function normaliseReplyText(text) {
  if (typeof text !== "string") return "";
  let normalized = text;

  // Figurine unicode: ♔♕♖♗♘♙♚♛♜♝♞♟ -> KQRBNP
  const figurineMap = {
    "♔": "K",
    "♕": "Q",
    "♖": "R",
    "♗": "B",
    "♘": "N",
    "♙": "P",
    "♚": "K",
    "♛": "Q",
    "♜": "R",
    "♝": "B",
    "♞": "N",
    "♟": "P",
  };
  for (const [unicode, letter] of Object.entries(figurineMap)) {
    normalized = normalized.split(unicode).join(letter);
  }

  // 0-0 -> O-O, 0-0-0 -> O-O-O
  normalized = normalized.replace(/0-0-0/g, "O-O-O").replace(/0-0/g, "O-O");

  // Remove annotations like !, ?, +#, but keep = for promotion
  // Keep brackets for UCI extraction
  // This is done in prompt.js normalise, but we also strip common markdown

  // Remove code fences but keep content
  normalized = normalized.replace(/```[\s\S]*?```/g, (match) => match.slice(3, -3));
  normalized = normalized.replace(/`([^`]+)`/g, "$1");

  return normalized;
}

/**
 * @param {Element} element
 * @returns {boolean} true when the element looks like a sending/in-flight indicator.
 */
export function isBusyIndicator(element) {
  if (!isElement(element)) {
    return false;
  }
  const label = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-testid") || ""}`;
  return /stop|streaming|generating|cancel/i.test(label);
}

/**
 * Checks whether a new user message appeared in the transcript after submit.
 *
 * @param {ParentNode} root
 * @param {ReadonlyArray<string>} userSelectors
 * @param {number} [timeout] ms
 * @returns {Promise<boolean>}
 */
export async function waitForUserMessage(root, userSelectors, timeout = 2000) {
  const start = Date.now();
  const initialCount = countUserMessages(root, userSelectors);

  return new Promise((resolve) => {
    const check = () => {
      const current = countUserMessages(root, userSelectors);
      if (current > initialCount) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve(false);
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

/**
 * @param {ParentNode} root
 * @param {ReadonlyArray<string>} selectors
 * @returns {number}
 */
function countUserMessages(root, selectors) {
  let count = 0;
  for (const selector of selectors) {
    try {
      count += root.querySelectorAll(selector).length;
    } catch {
      // ignore invalid
    }
  }
  return count;
}
