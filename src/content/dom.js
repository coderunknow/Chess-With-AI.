/**
 * DOM helpers for the content script.
 *
 * These utilities deal with the realities of modern chat UIs: virtualised
 * React lists, contenteditable editors (ProseMirror, Quill) and buttons that
 * only react to synthetic events with the right flags.
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
 * @param {ReadonlyArray<string>} selectors
 * @param {(element: Element) => boolean} [predicate]
 * @returns {Element|null} the matched element.
 */
export function findFirst(root, selectors, predicate = () => true) {
  for (const selector of selectors) {
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
 * Types `value` into a composer, using the technique that the different editor
 * stacks respond to.
 *
 * @param {HTMLElement} element
 * @param {string} value
 * @returns {boolean} true when the text is present in the composer afterwards.
 */
export function typeInto(element, value) {
  focusAtEnd(element);

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    setNativeValue(element, value);
    dispatchInputEvent(element, value);
    return element.value === value;
  }

  // Contenteditable editors (Quill in Gemini, ProseMirror in Claude, ...).
  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, value);
  } catch (error) {
    log.debug("execCommand insertText failed", error);
  }

  if (!inserted || !(element.textContent || "").includes(value.trim().slice(0, 20))) {
    // `beforeinput` is only constructible in some engines; fall back to a plain event.
    const beforeInput =
      typeof globalThis.InputEvent === "function"
        ? new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: value })
        : new Event("beforeinput", { bubbles: true, cancelable: true });
    element.dispatchEvent(beforeInput);
    element.textContent = value;
    inserted = false;
  }

  dispatchInputEvent(element, value);
  return inserted || (element.textContent || "").trim().length > 0;
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
