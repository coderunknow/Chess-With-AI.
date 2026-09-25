/**
 * Submit-truthfulness regression suite (v0.7.1).
 *
 * Locks in the fix for the top-priority bug: a WORKING send must never be
 * reported as "Could not submit the prompt. Send it manually to continue."
 * while the reply is still pending. Two layers are covered:
 *
 *  - content bridge: a send whose user echo the HOST reflows (appends a note,
 *    wraps nodes) is CONFIRMED, not a false "contradicted"; a genuinely
 *    different message still fails closed; a submit that lands but whose echo
 *    is slow is UNCONFIRMED, never a failure.
 *  - panel: while a send is pending or unconfirmed the panel NEVER shows
 *    status.submitFailed; a "nothing dispatched" verdict shows its own honest
 *    copy (not the generic submit failure) and never auto-resends.
 *
 * @module test/submit-truthfulness
 */

import assert from "node:assert/strict";
import test from "node:test";

import { installFakeDom } from "./helpers/fake-dom.js";
import { bootApp, delay } from "./helpers/boot-app.js";
import { ChatBridge, SendResult } from "../src/content/bridge.js";
import { buildMovePrompt } from "../src/shared/prompt.js";
import { getDictionary } from "../src/shared/i18n.js";

const en = getDictionary("en");

/** A realistic (>800-char-budget) chess move prompt is "prompt-shaped". */
const PROMPT = buildMovePrompt({
  fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 3",
  uci: "g1f3",
  san: "Nf3",
  aiColor: "b",
});

/**
 * Builds a chat page stub: one composer, one send button, one transcript.
 * @param {(ctx:{document:object, container:FakeElement, input:FakeElement})=>void} onSend
 */
function buildChatPage(onSend) {
  const dom = installFakeDom();
  const { document } = dom;
  const container = document.createElement("div");
  document.body.append(container);

  const input = document.createElement("textarea", { selectors: ["textarea"] });
  input.verticalOffset = 400;
  container.append(input);
  document.register(input, input.selectorMatches);

  const sendButton = document.createElement("button", { selectors: ["button[aria-label*='Send' i]"] });
  sendButton.verticalOffset = 420;
  sendButton.setAttribute("aria-label", "Send message");
  container.append(sendButton);
  document.register(sendButton, sendButton.selectorMatches);

  sendButton.addEventListener("click", () => {
    sendButton.clicked = (sendButton.clicked || 0) + 1;
    onSend({ document, container, input });
  });

  return { dom, document, container, input, sendButton };
}

/** Appends a new user-message node to the transcript. */
function userEcho(document, container, text) {
  const echo = document.createElement("div", { selectors: ["[data-message-author-role='user']"] });
  echo.textContent = text;
  document.register(echo, echo.selectorMatches);
  container.append(echo);
  return echo;
}

test("a send whose user echo the host reflows is CONFIRMED, not a false contradiction", async () => {
  // The composer clears (proof the message left) and the host renders our
  // prompt with a trailing annotation. The exact string differs from the
  // prompt, but it is unmistakably our echo. This is the top-priority bug:
  // before the fix the bridge returned submit-failed ("Could not submit…
  // Send it manually") while the send had actually worked.
  const { dom, sendButton } = buildChatPage(({ document, container, input }) => {
    userEcho(document, container, `${PROMPT}\n\n*(sent from the panel)*`);
    input.value = "";
  });
  try {
    const result = await new ChatBridge({ hostname: "chatgpt.com", submitSettleMs: 120 }).send(PROMPT);
    assert.equal(result.ok, true, `a reflowed echo must confirm, got ${result.result}: ${result.error}`);
    assert.equal(result.result, SendResult.OK);
    assert.equal(sendButton.clicked, 1, "exactly one submit event");
  } finally {
    dom.restore();
  }
});

test("a genuinely different new user message still fails closed as contradicted", async () => {
  // Preserve the fail-closed guarantee: an UNRELATED new user message with a
  // cleared composer is still provably not our prompt.
  const { dom, sendButton } = buildChatPage(({ document, container, input }) => {
    userEcho(document, container, "What is the weather like today?");
    input.value = "";
  });
  try {
    const result = await new ChatBridge({ hostname: "chatgpt.com", submitSettleMs: 120 }).send(PROMPT);
    assert.equal(result.ok, false);
    assert.equal(result.result, SendResult.SUBMIT_FAILED, "an unrelated message still fails closed");
    assert.equal(sendButton.clicked, 1);
  } finally {
    dom.restore();
  }
});

test("a submit that lands but whose echo is slow is UNCONFIRMED, not a failure", async () => {
  // One click happened; the composer did not clear and no echo rendered within
  // the settle window. Delivery is uncertain, so the verdict must be
  // submit-unconfirmed (check the chat) — never submit-failed.
  const { dom, sendButton, input } = buildChatPage(() => {
    /* the host accepts the click but renders nothing observable yet */
  });
  try {
    const result = await new ChatBridge({ hostname: "chatgpt.com", submitSettleMs: 90 }).send(PROMPT);
    assert.equal(sendButton.clicked, 1);
    assert.equal(result.ok, false);
    assert.equal(result.result, SendResult.SUBMIT_UNCONFIRMED, `got ${result.result}: ${result.error}`);
    assert.equal(input.value, PROMPT, "no Enter fallback; the composer is untouched");
  } finally {
    dom.restore();
  }
});

async function until(predicate, limit = 1500) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(5);
  }
  assert.ok(predicate(), "expected asynchronous state change did not occur");
}

/** Installs a scripted SEND_CHESS_PROMPT reply, delegating PING/diagnostics. */
function scriptSend(env, replyFor) {
  const originalSend = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type === "PING" || message.type === "GET_DIAGNOSTICS") return originalSend(tabId, message);
    if (message.type === "SEND_CHESS_PROMPT") {
      env.state.tabMessages.push({ tabId, message });
      return replyFor(message);
    }
    return originalSend(tabId, message);
  };
  return originalSend;
}

test("panel: a slow/unconfirmed send never shows 'Could not submit' and never auto-resends", async () => {
  const env = await bootApp();
  const originalSend = scriptSend(env, async () => {
    await delay(80); // the AI is (or should be) starting to generate
    return { ok: false, unconfirmed: true, result: "submit-unconfirmed", error: "unconfirmed" };
  });
  const submitFailedCopy = en["status.submitFailed"];
  const unconfirmedCopy = en["status.submitUnconfirmed"];
  try {
    await env.app.selectSquare(12); // select the e2 pawn
    const pending = env.app.selectSquare(28); // play e2e4 → the send path starts
    await until(() => env.prompts().length >= 1);
    // While the reply is still pending the panel must NOT claim a hard failure.
    assert.notEqual(env.refs.status.textContent, submitFailedCopy);
    assert.doesNotMatch(env.refs.status.textContent, /Send it manually/i);
    await pending; // the send resolves to submit-unconfirmed
    await until(() => env.refs.status.textContent === unconfirmedCopy);
    assert.equal(env.prompts().length, 1, "an unconfirmed send must never auto-resend");

    // The reply still resolves the pending request (echo gate, no second submit).
    const id = env.prompts().at(-1).message.requestId;
    env.emitRuntimeMessage(
      { type: "AI_MOVE", move: "e7e5", candidates: ["e7e5"], requestId: id, platform: "chatgpt" },
      { tab: { id: 7 } },
    );
    await until(() => env.app.session.plyCount === 2);
    assert.equal(env.prompts().length, 1, "resolving the reply issues no new prompt");
    assert.match(env.refs.status.textContent, /Your move/i);
  } finally {
    chrome.tabs.sendMessage = originalSend;
    env.teardown();
  }
});

test("panel: a 'nothing dispatched' verdict shows its own honest copy, not the generic failure", async () => {
  // The content proved nothing was submitted. The panel must say so precisely
  // (status.submitNotDispatched) instead of the generic submitFailed copy.
  const env = await bootApp();
  const originalSend = scriptSend(env, async () => ({
    ok: false,
    result: "submit-not-dispatched",
    error: "Nothing was submitted.",
  }));
  const submitFailedCopy = en["status.submitFailed"];
  const notDispatchedCopy = en["status.submitNotDispatched"];
  try {
    await env.app.selectSquare(12);
    await env.app.selectSquare(28); // auto-send resolves to "nothing dispatched"
    await until(() => env.prompts().length >= 1 && env.refs.status.textContent !== "");
    assert.equal(env.refs.status.textContent, notDispatchedCopy);
    assert.notEqual(env.refs.status.textContent, submitFailedCopy);
    assert.equal(env.refs["copy-prompt"].hidden, false, "Copy recovery is offered (nothing was sent)");
  } finally {
    chrome.tabs.sendMessage = originalSend;
    env.teardown();
  }
});

test("panel: a contradicted verdict still shows the submit-failed copy with Copy recovery", async () => {
  // A different new message appeared, so the prompt provably did not go out.
  // status.submitFailed + Copy is the honest outcome here.
  const env = await bootApp();
  const originalSend = scriptSend(env, async () => ({
    ok: false,
    result: "submit-failed",
    error: "The page shows a different new message.",
  }));
  const submitFailedCopy = en["status.submitFailed"];
  try {
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    await until(() => env.prompts().length >= 1 && env.refs.status.textContent !== "");
    assert.equal(env.refs.status.textContent, submitFailedCopy);
    assert.equal(env.refs["copy-prompt"].hidden, false, "Copy recovery matches a provably-unsent prompt");
  } finally {
    chrome.tabs.sendMessage = originalSend;
    env.teardown();
  }
});
