import assert from "node:assert/strict";
import test from "node:test";

import { FakeElement, FakeMutationObserver, installFakeDom } from "./helpers/fake-dom.js";

import { ChatBridge, SendResult } from "../src/content/bridge.js";
import { MoveWatcher } from "../src/content/observer.js";
import {
  isEditable,
  isUserSideElement,
  isVisible,
  textOf,
  typeInto,
  verifyComposerContains,
} from "../src/content/dom.js";
import { PLATFORMS } from "../src/shared/platforms.js";
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
    sendButton.setAttribute("aria-label", "Send message");
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
    const replies = [];
    const watcher = new MoveWatcher({
      onMove: (event) => replies.push(event),
      assistantSelectors: () => ["[data-message-author-role='assistant']"],
      settleMs: 5,
      maxWaitMs: 20,
    });
    input.value = "";
    watcher.expectReply("Chess move request. Position (FEN): test");
    watcher.markSubmitted();
    const reply = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    reply.textContent = "I will play [e7e5].";
    document.register(reply, reply.selectorMatches);
    container.append(reply);

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
    input.value = "";
    watcher.expectReply(prompt);
    watcher.markSubmitted();
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

test("full-string composer equality rejects prefixes and extra text", () => {
  const { dom, input } = buildChatPage();
  try {
    input.value = "Chess move request. This is a short prefix.";
    assert.equal(
      verifyComposerContains(input, "Chess move request. This is a short prefix. Here is the rest of the prompt."),
      false,
    );
    input.value = "Chess move request. This is a short prefix. Here is the rest of the prompt. Extra text";
    assert.equal(
      verifyComposerContains(input, "Chess move request. This is a short prefix. Here is the rest of the prompt."),
      false,
    );
    input.value = "Chess   move\nrequest.   Full prompt.";
    assert.equal(verifyComposerContains(input, "Chess move request. Full prompt."), true);
  } finally {
    dom.restore();
  }
});

test("a composer that truncates text is never submitted", async () => {
  const { dom, input, sendButton } = buildChatPage();
  try {
    Object.defineProperty(input, "value", {
      configurable: true,
      get() {
        return this.partial || "";
      },
      set(value) {
        this.partial = String(value).slice(0, 32);
      },
    });
    const bridge = new ChatBridge({ hostname: "chatgpt.com", inputTimeout: 50 });
    const result = await bridge.send("Chess move request. A much longer prompt than the first thirty characters.");
    assert.equal(result.ok, false);
    assert.equal(result.result, SendResult.VERIFY_FAILED);
    assert.equal(sendButton.clicked || 0, 0);
    assert.equal(result.diagnostics.verification.fullStringEquality, false);
  } finally {
    dom.restore();
  }
});

test("one button click without acknowledgement never falls back to Enter or requestSubmit", async () => {
  const { dom, input, sendButton } = buildChatPage();
  try {
    sendButton.listeners.set("click", [
      () => {
        sendButton.clicked = (sendButton.clicked || 0) + 1;
      },
    ]);
    let enters = 0;
    input.addEventListener("keydown", () => {
      enters += 1;
    });
    const result = await new ChatBridge({ hostname: "chatgpt.com", submitSettleMs: 110 }).send("Full chess prompt");
    assert.equal(result.ok, false, "an unchanged composer is ambiguous");
    assert.equal(sendButton.clicked, 1);
    assert.equal(enters, 0);
    assert.equal(result.diagnostics.submitMethod, "button");
    assert.equal(result.diagnostics.verification.secondEventSuppressed, true);
  } finally {
    dom.restore();
  }
});

test("a different new user message contradicts an empty composer and fails closed", async () => {
  const { dom, document, container, input, sendButton } = buildChatPage();
  try {
    sendButton.listeners.set("click", [
      () => {
        sendButton.clicked = (sendButton.clicked || 0) + 1;
        const echo = document.createElement("div", { selectors: ["[data-message-author-role='user']"] });
        echo.textContent = "A different prompt was sent";
        document.register(echo, echo.selectorMatches);
        container.append(echo);
        input.value = "";
      },
    ]);
    const result = await new ChatBridge({ hostname: "chatgpt.com", submitSettleMs: 100 }).send("Full chess prompt");
    assert.equal(result.result, SendResult.SUBMIT_FAILED);
    assert.equal(sendButton.clicked, 1);
    assert.equal(
      input.dispatched.some((event) => event.type === "keydown"),
      false,
    );
  } finally {
    dom.restore();
  }
});

test("an Enter-only composer emits exactly one key event across the supported hosts", async () => {
  for (const platform of PLATFORMS) {
    const { dom, input } = buildChatPage({ withSendButton: false });
    try {
      let submits = 0;
      for (const kind of ["keydown", "keypress", "keyup"]) {
        input.addEventListener(kind, () => {
          submits += 1;
          input.value = "";
        });
      }
      const result = await new ChatBridge({ hostname: platform.hosts[0], submitSettleMs: 100 }).send(
        "Complete chess prompt",
      );
      assert.equal(result.ok, true, platform.id);
      assert.equal(result.method, "enter");
      assert.equal(submits, 1, `${platform.id}: one event even if site handles all three kinds`);
      assert.equal(input.dispatched.filter((event) => event.key === "Enter").length, 1);
    } finally {
      dom.restore();
    }
  }
});

test("two new user messages are an ambiguous failure, with no retry keystroke", async () => {
  const { dom, document, container, input, sendButton } = buildChatPage();
  try {
    sendButton.listeners.set("click", [
      () => {
        sendButton.clicked = (sendButton.clicked || 0) + 1;
        for (let i = 0; i < 2; i += 1) {
          const echo = document.createElement("div", { selectors: ["[data-message-author-role='user']"] });
          echo.textContent = "Chess prompt";
          document.register(echo, echo.selectorMatches);
          container.append(echo);
        }
        input.value = "";
      },
    ]);
    const result = await new ChatBridge({ hostname: "chatgpt.com", submitSettleMs: 100 }).send("Chess prompt");
    assert.equal(result.ok, false);
    assert.equal(sendButton.clicked, 1);
    assert.equal(
      input.dispatched.some((event) => event.type === "keydown"),
      false,
    );
  } finally {
    dom.restore();
  }
});

test("a visible Stop prevents typing, clicking and Enter on every supported host", async () => {
  for (const platform of PLATFORMS) {
    const { dom, document, container, input, sendButton } = buildChatPage();
    try {
      const stop = document.createElement("button", { selectors: ["button[aria-label*='stop' i]"] });
      stop.setAttribute("aria-label", "Stop generating");
      stop.addEventListener("click", () => {
        stop.clicked = true;
      });
      document.register(stop, stop.selectorMatches);
      container.append(stop);
      const states = [];
      const bridge = new ChatBridge({ hostname: platform.hosts[0], generationWaitMs: 50, inputTimeout: 50 });
      const result = await bridge.send("A complete chess prompt", { onStatus: (state) => states.push(state) });
      assert.equal(result.result, SendResult.GENERATION_TIMEOUT, platform.id);
      assert.equal(stop.clicked, undefined, `${platform.id}: never click Stop`);
      assert.equal(sendButton.clicked, undefined, `${platform.id}: never click send while generating`);
      assert.equal(input.value, "", `${platform.id}: never type while generating`);
      assert.equal(
        input.dispatched.some((event) => event.key === "Enter"),
        false,
      );
      assert.ok(states.includes("generation-wait"));
      assert.equal(result.diagnostics.verification.stopControlSeen, true);
    } finally {
      dom.restore();
    }
  }
});

test("waiting for Stop is part of the in-flight guard; then a single button click sends", async () => {
  const { dom, document, container, input, sendButton } = buildChatPage();
  try {
    const stop = document.createElement("button", { selectors: ["button[title*='stop' i]"] });
    stop.setAttribute("title", "Dừng trả lời");
    document.register(stop, stop.selectorMatches);
    container.append(stop);
    const bridge = new ChatBridge({ hostname: "chatgpt.com", generationWaitMs: 500 });
    const first = bridge.send("Full prompt");
    const second = await bridge.send("Second prompt");
    assert.equal(second.ok, false, "a retry cannot overlap generation wait");
    setTimeout(() => {
      stop.visible = false;
    }, 35);
    const result = await first;
    assert.equal(result.ok, true);
    assert.equal(sendButton.clicked, 1);
    assert.ok(result.diagnostics.timings.generationWait > 0);
    assert.equal(
      input.dispatched.some((event) => event.key === "Enter"),
      false,
    );
  } finally {
    dom.restore();
  }
});

test("Manual mode requires the full new user echo and accepts a fast reply in the same mutation batch", async () => {
  const { dom, document, container } = buildChatPage();
  FakeMutationObserver.takeAll();
  try {
    const prompt = "Chess move request. Position (FEN): 8/8/8/8/8/8/8/K6k w - - 0 1";
    const seen = [];
    const watcher = new MoveWatcher({
      onMove: (event) => seen.push(event),
      assistantSelectors: () => ["[data-message-author-role='assistant']"],
      userSelectors: ["[data-message-author-role='user']"],
      settleMs: 5,
      maxWaitMs: 20,
    });
    watcher.expectReply(prompt, { manual: true });
    const observer = FakeMutationObserver.created.at(-1);
    const assistant = (text) => {
      const node = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
      node.textContent = text;
      document.register(node, node.selectorMatches);
      container.append(node);
      return node;
    };
    const user = (text) => {
      const node = document.createElement("div", { selectors: ["[data-message-author-role='user']"] });
      node.textContent = text;
      document.register(node, node.selectorMatches);
      container.append(node);
      return node;
    };
    const old = assistant("[a7a5]");
    observer.trigger([{ target: old, addedNodes: [old] }]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(seen, [], "copying a prompt cannot arm an assistant reply");
    const echo = user(prompt);
    const fresh = assistant("[e7e5]");
    observer.trigger([
      { target: container, addedNodes: [echo] },
      { target: container, addedNodes: [fresh] },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(
      seen.map((entry) => entry.move),
      ["e7e5"],
      "new reply must not be lost to a DOM rebase",
    );
    observer.trigger([{ target: old, addedNodes: [old] }]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(seen.length, 1, "the pre-echo assistant remains ineligible");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("a partial Manual echo and a pre-echo assistant cannot arm a reply", async () => {
  const { dom, document, container } = buildChatPage();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    const watcher = new MoveWatcher({
      onMove: (event) => seen.push(event),
      assistantSelectors: () => ["[data-message-author-role='assistant']"],
      userSelectors: ["[data-message-author-role='user']"],
      settleMs: 5,
      maxWaitMs: 20,
    });
    watcher.expectReply("Full chess prompt and FEN", { manual: true });
    const partial = document.createElement("div", { selectors: ["[data-message-author-role='user']"] });
    partial.textContent = "Full chess prompt";
    document.register(partial, partial.selectorMatches);
    container.append(partial);
    const old = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    old.textContent = "[e7e5]";
    document.register(old, old.selectorMatches);
    container.append(old);
    const observer = FakeMutationObserver.created.at(-1);
    observer.trigger([
      { target: container, addedNodes: [partial] },
      { target: container, addedNodes: [old] },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(seen, []);
    partial.textContent = "Full chess prompt and FEN";
    observer.trigger([
      { target: partial, addedNodes: [] },
      { target: old, addedNodes: [] },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(seen, [], "a reply that predates the full echo stays ineligible");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("an old assistant container cannot be replayed after an observer restart", async () => {
  const { dom, document, container } = buildChatPage();
  FakeMutationObserver.takeAll();
  try {
    const old = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    old.textContent = "[e7e5]";
    document.register(old, old.selectorMatches);
    container.append(old);
    const seen = [];
    const watcher = new MoveWatcher({
      onMove: (event) => seen.push(event),
      assistantSelectors: () => ["[data-message-author-role='assistant']"],
      settleMs: 5,
      maxWaitMs: 20,
    });
    watcher.expectReply("Chess move request. Position (FEN): new");
    watcher.markSubmitted();
    const observer = FakeMutationObserver.created.at(-1);
    observer.trigger([{ target: old, addedNodes: [old] }]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(seen, []);
    watcher.stop();
    watcher.expectReply("The move [a7a5] is not legal. Position (FEN): new", { rejectedMoves: ["a7a5"] });
    watcher.markSubmitted();
    const fresh = document.createElement("div", { selectors: ["[data-message-author-role='assistant']"] });
    fresh.textContent = "[a7a5] [c7c5]";
    document.register(fresh, fresh.selectorMatches);
    container.append(fresh);
    FakeMutationObserver.created.at(-1).trigger([{ target: fresh, addedNodes: [fresh] }]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].move, "a7a5", "the rejected first answer cannot be silently replaced by a quoted example");
    assert.equal(seen[0].repeated, true);
    assert.equal(seen[0].noMove, true);
    watcher.stop();
  } finally {
    dom.restore();
  }
});
