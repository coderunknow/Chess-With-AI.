/**
 * Reply-path regression suite (v0.7.2): "the AI answered, but the board
 * didn't move".
 *
 * Content layer only (the panel layer lives in test/reply-apply.test.js):
 *
 *  - H1 echo gate: after an UNCONFIRMED send, a reply that lands in its own
 *    new assistant container is attributable and is delivered — never parked
 *    forever in the queue — and the host's real echo shape (ChatGPT's
 *    "You said:" turn article) opens the gate. Exactly one submit, always.
 *  - H2 nomination: a pre-created (empty) or re-used assistant container that
 *    later receives the move is still scanned; an unchanged old reply is not.
 *  - Streaming: a reply still streaming past MAX_WAIT never yields a premature
 *    no-move (which used to stop the watcher and lose the real move), and a
 *    half-streamed bare token is never taken as a move.
 *  - H3 parse: a container that quotes the whole prompt verbatim before the
 *    answer still yields the answer; the echo itself never becomes a move.
 *  - Honest no-move: a settled prose reply with no move yields a no-move
 *    verdict instead of a silent stall — but never while the host generates.
 *
 * All timing here uses tiny settle windows and only asserts presence/order,
 * never durations.
 *
 * @module test/observer-reply
 */

import assert from "node:assert/strict";
import test from "node:test";

import { FakeMutationObserver, installFakeDom } from "./helpers/fake-dom.js";
import { installFakeChrome } from "./helpers/fake-chrome.js";
import { MoveWatcher } from "../src/content/observer.js";
import { ReplyGate } from "../src/content/reply-gate.js";
import { MessageType } from "../src/shared/messaging.js";
import { buildMovePrompt } from "../src/shared/prompt.js";

const PROMPT = buildMovePrompt({
  fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
  uci: "g1f3",
  san: "Nf3",
  aiColor: "b",
});

const ASSISTANT = "[data-message-author-role='assistant']";
const USER = "[data-message-author-role='user']";
const TURN = "article[data-testid^='conversation-turn']";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, limit = 2000) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.ok(predicate(), "expected asynchronous state change did not occur");
}

function page() {
  const dom = installFakeDom();
  const { document } = dom;
  const container = document.createElement("div");
  document.body.append(container);
  const node = (selectors, text = "", parent = container) => {
    const element = document.createElement("div", { selectors });
    element.textContent = text;
    document.register(element, selectors);
    parent.append(element);
    return element;
  };
  return { dom, document, container, node };
}

function watcherFor(seen, extra = {}) {
  return new MoveWatcher({
    onMove: (event) => seen.push(event),
    assistantSelectors: () => [ASSISTANT],
    userSelectors: [USER, TURN],
    settleMs: 5,
    maxWaitMs: 20,
    stableMs: 10,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// H1 — echo gate (observer layer)
// ---------------------------------------------------------------------------

test("H1: ChatGPT's real echo shape (a 'You said:' turn article) opens the echo gate", async () => {
  const { dom, container, node } = page();
  FakeMutationObserver.takeAll();
  try {
    let echoes = 0;
    const watcher = watcherFor([], { onEcho: () => (echoes += 1) });
    watcher.expectReply(PROMPT);
    watcher.markSubmitted();
    watcher.requireUserEcho();
    // ChatGPT wraps each user turn in an <article> whose text carries a
    // screen-reader prefix. userMessageSnapshot keeps the OUTER article.
    const article = node([TURN], `You said:\n${PROMPT}`);
    node([USER], PROMPT, article);
    FakeMutationObserver.created.at(-1).trigger([{ target: container, addedNodes: [article] }]);
    await sleep(10);
    assert.equal(echoes, 1, "the matching NEW echo must open the gate exactly once");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("H1: echo and reply in ONE mutation batch open the gate and report the move", async () => {
  const { dom, container, node } = page();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    let echoes = 0;
    const watcher = watcherFor(seen, { onEcho: () => (echoes += 1) });
    watcher.expectReply(PROMPT);
    watcher.markSubmitted();
    watcher.requireUserEcho();
    const echo = node([USER], PROMPT);
    const reply = node([ASSISTANT], "I play [b8c6].");
    FakeMutationObserver.created.at(-1).trigger([
      { target: container, addedNodes: [echo] },
      { target: container, addedNodes: [reply] },
    ]);
    await until(() => seen.length === 1);
    assert.equal(echoes, 1);
    assert.equal(seen[0].move, "b8c6");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("ReplyGate: a queued reply is never stranded; a post-submit reply attributes itself", () => {
  const delivered = [];
  const gate = new ReplyGate({ deliver: (event) => delivered.push(event) });

  // Reply arrives during verification → queued; the verdict is UNCONFIRMED.
  gate.begin();
  assert.equal(gate.offer({ move: "e7e5" }), "queued");
  assert.deepEqual(delivered, []);
  gate.unconfirmed();
  assert.deepEqual(
    delivered.map((e) => e.move),
    ["e7e5"],
    "the parked reply is delivered — it came from a NEW post-submit container",
  );
  assert.equal(gate.attribution, "reply");

  // No queue: unconfirmed first, then the reply (no echo ever renders).
  gate.begin();
  gate.unconfirmed();
  assert.equal(gate.offer({ move: "g8f6" }), "delivered");
  assert.equal(delivered.at(-1).move, "g8f6");

  // The echo opens the gate first → attribution "echo".
  gate.begin();
  gate.unconfirmed();
  assert.equal(gate.echo(), true);
  assert.equal(gate.attribution, "echo");
  assert.equal(gate.echo(), false, "the gate opens once");
  assert.equal(gate.offer({ move: "d7d5" }), "delivered");

  // Confirmed send flushes a fast reply.
  gate.begin();
  gate.offer({ move: "c7c5" });
  gate.ready();
  assert.equal(delivered.at(-1).move, "c7c5");

  // A failed/cancelled/paused request drops its queue and delivers nothing later.
  gate.begin();
  gate.offer({ move: "a7a6" });
  gate.reset();
  assert.equal(gate.offer({ move: "h7h6" }), "dropped");
  assert.equal(delivered.at(-1).move, "c7c5", "nothing from a dead request is delivered");
  assert.equal(gate.queued, null);
});

// ---------------------------------------------------------------------------
// H1 — echo gate, end to end through the real content entry (main.js)
// ---------------------------------------------------------------------------

async function bootContent({ submitSettleMs = 60 } = {}) {
  const { dom, document, container, node } = page();
  const fake = installFakeChrome({ storage: { settings: {} } });
  FakeMutationObserver.takeAll();
  const input = document.createElement("textarea", { selectors: ["textarea"] });
  input.verticalOffset = 400;
  container.append(input);
  document.register(input, input.selectorMatches);
  const send = document.createElement("button", { selectors: ["button[aria-label*='Send' i]"] });
  send.verticalOffset = 420;
  send.setAttribute("aria-label", "Send message");
  container.append(send);
  document.register(send, send.selectorMatches);
  // The host swallows the click's evidence: composer keeps its text and no
  // echo renders within the settle window → the bridge says UNCONFIRMED.
  send.addEventListener("click", () => {
    send.clicked = (send.clicked || 0) + 1;
  });
  const { startContentScript } = await import("../src/content/main.js");
  assert.equal(
    startContentScript({
      bridgeOptions: { submitSettleMs },
      watcherOptions: { settleMs: 5, maxWaitMs: 20, stableMs: 10 },
    }),
    true,
  );
  const aiMoves = () => fake.state.runtimeMessages.filter((m) => m.type === MessageType.AI_MOVE);
  const statuses = () => fake.state.runtimeMessages.filter((m) => m.type === MessageType.CONTENT_STATUS);
  return {
    dom,
    fake,
    container,
    node,
    send,
    aiMoves,
    statuses,
    observer: () => FakeMutationObserver.created.at(-1),
    restore() {
      delete globalThis.__AI_CHESS_COMPANION_STARTED__;
      dom.restore();
      fake.restore();
    },
  };
}

test("H1 e2e: an UNCONFIRMED send's reply in its own new container reaches the panel, one submit only", async () => {
  const env = await bootContent();
  try {
    const response = await env.fake.dispatchMessage({
      type: MessageType.SEND_CHESS_PROMPT,
      prompt: PROMPT,
      requestId: 4,
    });
    assert.equal(response.result, "submit-unconfirmed", `got ${response.result}: ${response.error}`);
    assert.ok(env.statuses().some((s) => s.state === "submit-unconfirmed"));
    // No echo ever renders on this host; the assistant simply answers.
    const reply = env.node([ASSISTANT], "My move: [e7e6]");
    env.observer().trigger([{ target: env.container, addedNodes: [reply] }]);
    await until(() => env.aiMoves().length === 1);
    assert.equal(env.aiMoves()[0].move, "e7e6");
    assert.equal(env.aiMoves()[0].requestId, 4, "the reply is attributed to the live request");
    assert.equal(env.aiMoves()[0].diagnostics.reply.attribution, "reply");
    assert.equal(env.send.clicked, 1, "exactly one submit — the gate never resends");
  } finally {
    env.restore();
  }
});

test("H1 e2e: a reply that lands DURING verification is flushed when the verdict is unconfirmed", async () => {
  const env = await bootContent({ submitSettleMs: 400 });
  try {
    let verdict = false;
    const pending = env.fake.dispatchMessage({ type: MessageType.SEND_CHESS_PROMPT, prompt: PROMPT, requestId: 5 });
    void pending.then(() => (verdict = true));
    await until(() => env.send.clicked === 1);
    const reply = env.node([ASSISTANT], "[d7d6]");
    env.observer().trigger([{ target: env.container, addedNodes: [reply] }]);
    await sleep(40); // scanned while the bridge is still verifying → queued
    // Order, not timing: only meaningful while the verdict is still pending.
    if (!verdict) assert.equal(env.aiMoves().length, 0, "not delivered before the send verdict");
    const response = await pending;
    assert.equal(response.result, "submit-unconfirmed");
    await until(() => env.aiMoves().length === 1);
    assert.equal(env.aiMoves()[0].move, "d7d6");
    assert.equal(env.send.clicked, 1);
  } finally {
    env.restore();
  }
});

test("H1 e2e: the ChatGPT-shaped echo flips an unconfirmed send to confirmed before the reply", async () => {
  const env = await bootContent();
  try {
    const response = await env.fake.dispatchMessage({
      type: MessageType.SEND_CHESS_PROMPT,
      prompt: PROMPT,
      requestId: 6,
    });
    assert.equal(response.result, "submit-unconfirmed");
    const article = env.node([TURN], `You said:\n${PROMPT}`);
    env.node([USER], PROMPT, article);
    env.observer().trigger([{ target: env.container, addedNodes: [article] }]);
    await until(() => env.statuses().some((s) => s.state === "prompt-echoed"));
    const reply = env.node([ASSISTANT], "[g8e7]");
    env.observer().trigger([{ target: env.container, addedNodes: [reply] }]);
    await until(() => env.aiMoves().length === 1);
    assert.equal(env.aiMoves()[0].diagnostics.reply.attribution, "echo");
    assert.equal(env.send.clicked, 1);
  } finally {
    env.restore();
  }
});

// ---------------------------------------------------------------------------
// H2 — nomination baseline
// ---------------------------------------------------------------------------

test("H2: a pre-created EMPTY assistant bubble that later receives the move is still scanned", async () => {
  const { dom, node } = page();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    const watcher = watcherFor(seen);
    watcher.expectReply(PROMPT);
    const bubble = node([ASSISTANT], ""); // host pre-renders the next turn
    watcher.markSubmitted(); // bubble is now in the baseline
    bubble.textContent = "I will play [c7c5].";
    FakeMutationObserver.created.at(-1).trigger([{ target: bubble, addedNodes: [] }]);
    await until(() => seen.length === 1);
    assert.equal(seen[0].move, "c7c5");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("H2: a re-used container whose content is fully replaced is scanned; an unchanged old reply is not", async () => {
  const { dom, node } = page();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    const watcher = watcherFor(seen);
    const old = node([ASSISTANT], "Earlier I played [a7a6].");
    const reused = node([ASSISTANT], "Earlier I played [h7h6].");
    watcher.expectReply(PROMPT);
    watcher.markSubmitted();
    const observer = FakeMutationObserver.created.at(-1);
    observer.trigger([{ target: old, addedNodes: [] }]); // re-render, same text
    await sleep(40);
    assert.deepEqual(seen, [], "an unchanged transcript reply is never replayed");
    reused.textContent = "Fresh answer: [b7b6]";
    observer.trigger([{ target: reused, addedNodes: [] }]);
    await until(() => seen.length === 1);
    assert.equal(seen[0].move, "b7b6");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

// ---------------------------------------------------------------------------
// Streaming past MAX_WAIT
// ---------------------------------------------------------------------------

test("streaming past MAX_WAIT never produces a premature no-move; the final move is captured", async () => {
  const { dom, container, node } = page();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    const watcher = watcherFor(seen);
    watcher.expectReply(PROMPT);
    watcher.markSubmitted();
    const observer = FakeMutationObserver.created.at(-1);
    const reply = node([ASSISTANT], "");
    observer.trigger([{ target: container, addedNodes: [reply] }]);
    let text = "Let me consider the position carefully. The plan should be to develop and fight for the centre";
    for (let i = 0; i < 12; i += 1) {
      text += " and think";
      reply.textContent = text;
      observer.trigger([{ target: reply, addedNodes: [] }]);
      await sleep(5); // 60ms of continuous streaming — well past maxWaitMs (20)
    }
    reply.textContent = `${text}. So I play [g8f6].`;
    observer.trigger([{ target: reply, addedNodes: [] }]);
    await until(() => seen.length >= 1);
    await sleep(30);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].noMove, undefined, "no premature no-move verdict mid-stream");
    assert.equal(seen[0].move, "g8f6");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("a half-streamed bare token ('[e7e8' before 'q]') is never taken as the move", async () => {
  const { dom, container, node } = page();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    const watcher = watcherFor(seen);
    watcher.expectReply(PROMPT);
    watcher.markSubmitted();
    const observer = FakeMutationObserver.created.at(-1);
    const reply = node([ASSISTANT], "Promoting: [e7e8");
    observer.trigger([{ target: container, addedNodes: [reply] }]);
    for (let i = 0; i < 6; i += 1) {
      reply.textContent = `Promoting${".".repeat(i + 1)} [e7e8`; // still streaming
      observer.trigger([{ target: reply, addedNodes: [] }]);
      await sleep(5);
    }
    reply.textContent = "Promoting: [e7e8q]";
    observer.trigger([{ target: reply, addedNodes: [] }]);
    await until(() => seen.length >= 1);
    await sleep(30);
    assert.deepEqual(
      seen.map((e) => e.move),
      ["e7e8q"],
    );
    watcher.stop();
  } finally {
    dom.restore();
  }
});

// ---------------------------------------------------------------------------
// H3 — parse
// ---------------------------------------------------------------------------

test("H3: a container quoting the whole prompt verbatim before the answer yields the answer, not the echo", async () => {
  const { dom, container, node } = page();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    const watcher = watcherFor(seen);
    watcher.expectReply(PROMPT);
    watcher.markSubmitted();
    const observer = FakeMutationObserver.created.at(-1);
    const pureEcho = node([ASSISTANT], PROMPT); // e.g. a host that renders the user bubble like an assistant one
    observer.trigger([{ target: container, addedNodes: [pureEcho] }]);
    await sleep(40);
    assert.deepEqual(seen, [], "the echoed prompt (with its [g8f6]/[g1f3] examples) is never a move");
    const wrapper = node([ASSISTANT], `${PROMPT}\n\nMy answer: [b8c6]`);
    observer.trigger([{ target: container, addedNodes: [wrapper] }]);
    await until(() => seen.length === 1);
    assert.equal(seen[0].move, "b8c6");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

// ---------------------------------------------------------------------------
// Honest no-move
// ---------------------------------------------------------------------------

test("a settled short prose reply with no move yields an honest no-move, not a silent stall", async () => {
  const { dom, container, node } = page();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    const watcher = watcherFor(seen);
    watcher.expectReply(PROMPT);
    watcher.markSubmitted();
    const reply = node([ASSISTANT], "Sounds good! Ready when you are.");
    FakeMutationObserver.created.at(-1).trigger([{ target: container, addedNodes: [reply] }]);
    await until(() => seen.length === 1);
    assert.equal(seen[0].noMove, true);
    assert.equal(seen[0].move, undefined, "a no-move verdict never carries a substituted move");
    watcher.stop();
  } finally {
    dom.restore();
  }
});

test("no no-move verdict is issued while the host is still generating", async () => {
  const { dom, container, node } = page();
  FakeMutationObserver.takeAll();
  try {
    const seen = [];
    let generating = true;
    const watcher = watcherFor(seen, { isGenerating: () => generating });
    watcher.expectReply(PROMPT);
    watcher.markSubmitted();
    const observer = FakeMutationObserver.created.at(-1);
    const reply = node([ASSISTANT], "Thinking about the position before I answer…");
    observer.trigger([{ target: container, addedNodes: [reply] }]);
    await sleep(80);
    assert.deepEqual(seen, [], "a 'thinking' placeholder is not a reply");
    reply.textContent = "Thinking about the position before I answer… [e7e5]";
    generating = false;
    observer.trigger([{ target: reply, addedNodes: [] }]);
    await until(() => seen.length === 1);
    assert.equal(seen[0].move, "e7e5");
    watcher.stop();
  } finally {
    dom.restore();
  }
});
