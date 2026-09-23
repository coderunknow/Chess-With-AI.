(function bootstrapContentScript() {
  if (window.__AI_CHESS_COMPANION_LOADED__) {
    return;
  }
  window.__AI_CHESS_COMPANION_LOADED__ = true;

  const MOVE_PATTERN = /\[([a-h][1-8][a-h][1-8][qrbn]?)\]/gi;
  const INPUT_SELECTORS = [
    "textarea",
    "div[contenteditable=\"true\"]",
    "[role=\"textbox\"]"
  ];
  const SEND_SELECTORS = [
    "button[aria-label*='Send' i]",
    "button[title*='Send' i]",
    "button[data-testid*='send' i]",
    "[role='button'][aria-label*='Send' i]",
    "button[type='submit']"
  ];

  let lastPrompt = "";
  let lastPromptMove = "";
  let lastPromptAt = 0;
  let lastReportedMove = "";
  let lastReportedAt = 0;
  let responseObserver = null;

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity) !== 0
      && rect.width > 0
      && rect.height > 0;
  }

  function isEditable(element) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false;
    }
    if (element.matches("textarea, input")) {
      return !element.disabled && !element.readOnly;
    }
    return element.isContentEditable && element.getAttribute("aria-disabled") !== "true";
  }

  function findChatInput() {
    const candidates = [];
    for (const selector of INPUT_SELECTORS) {
      candidates.push(...document.querySelectorAll(selector));
    }

    return candidates
      .filter(isEditable)
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.bottom - leftRect.bottom;
      })[0] || null;
  }

  function waitForChatInput(timeoutMs = 5000) {
    const immediate = findChatInput();
    if (immediate) {
      return Promise.resolve(immediate);
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const intervalId = window.setInterval(() => {
        const input = findChatInput();
        if (input || Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(intervalId);
          resolve(input);
        }
      }, 100);
    });
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function populateInput(input, value) {
    input.focus();

    if (input.matches("textarea, input")) {
      setNativeValue(input, value);
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);

      const inserted = document.execCommand("insertText", false, value);
      if (!inserted || input.textContent !== value) {
        input.textContent = value;
      }
    }

    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: value
    }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findSendButton(input) {
    const form = input.closest("form");
    const scopes = [form, input.parentElement, document].filter(Boolean);
    for (const scope of scopes) {
      for (const selector of SEND_SELECTORS) {
        const button = scope.querySelector(selector);
        if (button && isVisible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
          return button;
        }
      }
    }
    return null;
  }

  function submitInput(input) {
    const sendButton = findSendButton(input);
    if (sendButton) {
      sendButton.click();
      return "button";
    }

    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    input.dispatchEvent(new KeyboardEvent("keypress", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    input.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    return "enter";
  }

  function normaliseMove(value) {
    const move = String(value || "").toLowerCase();
    return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? move : "";
  }

  function getMoveFromText(text) {
    if (typeof text !== "string" || !text || text.length > 20000) {
      return "";
    }

    MOVE_PATTERN.lastIndex = 0;
    const matches = [...text.matchAll(MOVE_PATTERN)];
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const candidate = normaliseMove(matches[index][1]);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }

  function isOutgoingText(text) {
    if (!lastPrompt || !text) {
      return false;
    }
    const normalisedText = text.replace(/\s+/g, " ").trim();
    const normalisedPrompt = lastPrompt.replace(/\s+/g, " ").trim();
    return normalisedText === normalisedPrompt
      || normalisedText.startsWith(`${normalisedPrompt} `)
      || normalisedText.endsWith(` ${normalisedPrompt}`);
  }

  function isInputOrUserNode(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    return Boolean(element.closest("textarea, input, [contenteditable='true'], [data-message-author-role='user'], [data-testid*='user' i]"));
  }

  function reportMove(move) {
    if (!move || move === lastPromptMove && Date.now() - lastPromptAt < 3000) {
      return;
    }
    if (move === lastReportedMove && Date.now() - lastReportedAt < 15000) {
      return;
    }

    lastReportedMove = move;
    lastReportedAt = Date.now();
    chrome.runtime.sendMessage({ type: "AI_MOVE", move }).catch(() => undefined);
  }

  function inspectNode(node) {
    const element = node instanceof Element
      ? node
      : node instanceof CharacterData ? node.parentElement : null;
    if (!element || isInputOrUserNode(element)) {
      return;
    }

    const candidates = [element];
    if (element.querySelectorAll) {
      candidates.push(...element.querySelectorAll("article, [role='article'], [data-message-author-role='assistant'], [class*='message' i], [class*='response' i]"));
    }

    for (const candidate of candidates.slice(-12)) {
      const text = candidate.innerText || candidate.textContent || "";
      if (!text || isOutgoingText(text)) {
        continue;
      }
      const move = getMoveFromText(text);
      if (move) {
        reportMove(move);
        return;
      }
    }
  }

  function startResponseObserver() {
    if (responseObserver) {
      responseObserver.disconnect();
    }
    if (!document.body) {
      return;
    }

    responseObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        inspectNode(mutation.target);
        for (const addedNode of mutation.addedNodes) {
          inspectNode(addedNode);
        }
      }
    });
    responseObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }

  async function sendPrompt(prompt) {
    const cleanPrompt = typeof prompt === "string" ? prompt.trim() : "";
    if (!cleanPrompt) {
      return { ok: false, error: "The chess prompt is empty." };
    }

    const input = await waitForChatInput();
    if (!input) {
      return { ok: false, error: "Could not find the AI chat input." };
    }

    lastPrompt = cleanPrompt;
    lastPromptAt = Date.now();
    const promptMoveMatch = cleanPrompt.match(/\[([a-h][1-8][a-h][1-8][qrbn]?)\]/i);
    lastPromptMove = promptMoveMatch ? normaliseMove(promptMoveMatch[1]) : "";
    startResponseObserver();
    populateInput(input, cleanPrompt);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const method = submitInput(input);
    return { ok: true, method };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "SEND_CHESS_PROMPT") {
      return false;
    }

    sendPrompt(message.prompt)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || "Could not send the chess prompt." }));
    return true;
  });

  chrome.runtime.sendMessage({ type: "CONTENT_READY", url: window.location.href }).catch(() => undefined);
})();
