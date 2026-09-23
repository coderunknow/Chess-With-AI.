import assert from "node:assert/strict";
import test from "node:test";

import { FakeElement, FakeMutationObserver, installFakeDom } from "./helpers/fake-dom.js";

import { ChatBridge, SendResult } from "../src/content/bridge.js";
import { MoveWatcher } from "../src/content/observer.js";
import { isEditable, isUserSideElement, isVisible, textOf, typeInto } from "../src/content/dom.js";
import { buildMovePrompt } from "../src/shared/prompt.js";

/**
 * Builds a chat page stub: one composer plus a transcript container.
 *
 * @param {object} [options]
 * @param {boolean} [options.contentEditable] use a contenteditable composer.
 * @param {boolean} [options.withSendButton] register a send button.
 * @returns {object} handles for the test.
 */
function buildChatPage({ contentEditable = false, withSendButton = true } = {}) {
  const dom = installFakeDom();
  const { document } = dom;

  const container = document.createElement("div");
  document.body.append(container);

  const input = contentEditable
    ? document.createElement("div", { selectors: ["div[contenteditable='true']", "[role='textbox']"], editable: true })
    : document.createElement("textarea", { selectors: ["textarea"] });
  input.verticalOffset = 400;
  container.append(input);
  document.register(input, input.selectorMatches);

  let sendButton = null;
  if (withSendButton) {
    sendButton = document.createElement("button", { selectors: ["button[aria-label*='Send' i]"] });
    sendButton.verticalOffset = 420;
    container.append(sendButton);
    document.register(sendButton, sendButton.selectorMatches);
    sendButton.addEventListener("click", () => {
      sendButton.clicked = (sendButton.clicked || 0) + 1;
      input.value = "";
      input.textContent = "";
    });
  }

  return { dom, document, container, input, sendButton };
}

test("the composer is found and typed into", async () => {
  const { dom, input, sendButton } = buildChatPage();
  try {
    const bridge = new ChatBridge({ hostname: "chatgpt.com", inputTimeout: 50 });
    const result = await bridge.send("hello chess");

    assert.equal(result.ok, true);
    assert.equal(result.method, "button", "the send button is preferred");
    assert.equal(sendButton.clicked, 1, "the send button is clicked once");
    assert.equal(input.value, "", "a real composer clears itself after sending");
    assert.ok(
      input.dispatched.some((event) => event.type === "input"),
      "an input event is dispatched so React sees the change",
    );
  } finally {
    dom.restore();
  }
});

test("a contenteditable composer is supported", async () => {
  const { dom, input } = buildChatPage({ contentEditable: true, withSendButton: false });
  // Real sites empty the composer when the message is sent; the bridge detects it.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      input.textContent = "";
    }
  });
  try {
    const bridge = new ChatBridge({ hostname: "claude.ai", inputTimeout: 50 });
    const result = await bridge.send("play e4");

    assert.equal(result.ok, true);
    assert.ok(["enter", "enter-after-button"].includes(result.method));
    assert.ok(
      input.dispatched.some((event) => event.type === "keydown" && event.key === "Enter"),
      "Enter is pressed when there is no send button",
    );
  } finally {
    dom.restore();
  }
});

test("a missing composer is reported instead of throwing", async () => {
  const dom = installFakeDom();
  try {
    const bridge = new ChatBridge({ hostname: "chatgpt.com", inputTimeout: 60 });
    const result = await bridge.send("hello");

    assert.equal(result.ok, false);
    assert.equal(result.result, SendResult.NO_INPUT);
    assert.match(result.error, /chat input box/);
  } finally {
    dom.restore();
  }
});

test("DOM helpers reject hidden and read-only elements", () => {
  const dom = installFakeDom();
  try {
    const { document } = dom;
    const hidden = document.createElement("textarea", { visible: false });
    document.body.append(hidden);
    assert.equal(isVisible(hidden), false);
    assert.equal(isEditable(hidden), false);

    const readOnly = document.createElement("textarea");
    readOnly.readOnly = true;
    document.body.append(readOnly);
    assert.equal(isEditable(readOnly), false);

    const editable = document.createElement("textarea");
    document.body.append(editable);
    assert.equal(isEditable(editable), true);

    const div = document.createElement("div");
    document.body.append(div);
    assert.equal(isEditable(div), false, "a non-editable div is not a composer");
  } finally {
    dom.restore();
  }
});

test("text inside the composer or a user message is never treated as a reply", () => {
  const dom = installFakeDom();
  try {
    const { document } = dom;
    const form = document.createElement("form", { selectors: ["form"] });
    const input = document.createElement("textarea");
    form.append(input);
    assert.equal(isUserSideElement(input), true, "composer is user side");

    document.register(form, ["form"]);

    const userMessage = document.createElement("div", { selectors: ["[data-message-author-role='user']"] });
    document.register(userMessage, userMessage.selectorMatches);
    assert.equal(isUserSideElement(userMessage), true);

    const assistantMessage = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    document.body.append(assistantMessage);
    assert.equal(isUserSideElement(assistantMessage), false);
    assert.equal(textOf(assistantMessage), "");
  } finally {
    dom.restore();
  }
});

test("typing into a textarea keeps the exact prompt", () => {
  const dom = installFakeDom();
  try {
    const { document } = dom;
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    const prompt = "Chess move request.\nPosition (FEN): 8/8/8/8/8/8/8/K6k w - - 0 1";

    assert.equal(typeInto(textarea, prompt), true);
    assert.equal(textarea.value, prompt);
  } finally {
    dom.restore();
  }
});

test("the watcher reports a bracketed move from an AI reply", async () => {
  const { dom, document, container, input } = buildChatPage();
  FakeMutationObserver.takeAll();

  try {
    const reply = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    reply.textContent = "I will play [e7e5].";
    document.register(reply, reply.selectorMatches);
    container.append(reply);

    const replies = [];
    const watcher = new MoveWatcher({
      onMove: (event) => replies.push(event),
      assistantSelectors: () => ["[data-message-author-role='assistant']"],
      settleMs: 5,
      maxWaitMs: 20,
    });
    input.value = "";
    assert.equal(watcher.start(), true);

    FakeMutationObserver.created.at(-1).trigger([{ type: "childList", target: reply, addedNodes: [reply] }]);
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(replies.length, 1);
    assert.equal(replies[0].move, "e7e5");
    assert.deepEqual(replies[0].candidates, ["e7e5"]);
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("the watcher ignores echoes of its own prompt and duplicate moves", async () => {
  const { dom, document, container, input } = buildChatPage();
  FakeMutationObserver.takeAll();

  try {
    const prompt = buildMovePrompt({
      fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
      uci: "e2e4",
      san: "e4",
      aiColor: "b",
    });

    const echo = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    echo.textContent = prompt;
    document.register(echo, echo.selectorMatches);
    container.append(echo);

    const replies = [];
    const watcher = new MoveWatcher({
      onMove: (event) => replies.push(event),
      assistantSelectors: () => ["[data-message-author-role='assistant']"],
      settleMs: 5,
      maxWaitMs: 20,
    });
    watcher.rememberPrompt(prompt);
    input.value = "";
    watcher.start();
    const observer = FakeMutationObserver.created.at(-1);

    observer.trigger([{ type: "childList", target: echo, addedNodes: [echo] }]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(replies.length, 0, "the echoed prompt must not be parsed as a move");

    const reply = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    reply.textContent = "Ok: [g8f6]";
    document.register(reply, reply.selectorMatches);
    container.append(reply);
    observer.trigger([{ type: "childList", target: reply, addedNodes: [reply] }]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(replies.length, 1);

    observer.trigger([{ type: "childList", target: reply, addedNodes: [reply] }]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(replies.length, 1, "the same move is not reported twice");

    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("the watcher stays quiet when a reply contains no move", async () => {
  const { dom, document, container, input } = buildChatPage();
  FakeMutationObserver.takeAll();

  try {
    const reply = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    reply.textContent = "Sure, let me think about the position first.";
    document.register(reply, reply.selectorMatches);
    container.append(reply);

    const replies = [];
    const watcher = new MoveWatcher({
      onMove: (event) => replies.push(event),
      assistantSelectors: () => ["[data-message-author-role='assistant']"],
      settleMs: 5,
      maxWaitMs: 20,
    });
    input.value = "";
    watcher.start();

    FakeMutationObserver.created.at(-1).trigger([{ type: "childList", target: reply, addedNodes: [reply] }]);
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(replies.length, 0);
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("the watcher tolerates DOM mutations with no body yet", () => {
  const dom = installFakeDom();
  try {
    const previousBody = globalThis.document.body;
    globalThis.document.body = null;
    const watcher = new MoveWatcher({ onMove: () => undefined, assistantSelectors: () => [] });
    assert.equal(watcher.start(), false);
    globalThis.document.body = previousBody;
  } finally {
    dom.restore();
  }
});

test("FakeElement exposes the surface the UI relies on", () => {
  const element = new FakeElement("button");
  element.dataset.piece = "q";
  assert.equal(element.closest("[data-piece]"), element);
  assert.equal(element.textContent, "");

  const parent = new FakeElement("div");
  parent.append(element);
  assert.equal(parent.contains(element), true);
  assert.equal(parent.findById("missing"), null);
});
