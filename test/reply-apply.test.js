/**
 * Reply-path regression suite (v0.7.2) — panel layer.
 *
 * "The AI answered, but the board didn't move": once the content script hands
 * a reply to the panel, it must either be applied or produce a truthful,
 * recoverable state — never a silent freeze. The content layer lives in
 * test/observer-reply.test.js.
 *
 * @module test/reply-apply
 */

import assert from "node:assert/strict";
import test from "node:test";

import { bootApp, delay } from "./helpers/boot-app.js";
import { GameSession } from "../src/ui/game.js";
import { StatusAction, describeStatus } from "../src/ui/status.js";
import { createTranslator, getDictionary } from "../src/shared/i18n.js";

const en = getDictionary("en");
const pinned = { supported: true, label: "ChatGPT", platform: "chatgpt", tabId: 7 };

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
    if (message.type === "SEND_CHESS_PROMPT") {
      env.state.tabMessages.push({ tabId, message });
      return replyFor(message);
    }
    return originalSend(tabId, message);
  };
  return () => {
    chrome.tabs.sendMessage = originalSend;
  };
}

test("status truth: AI to move with NOTHING sent never claims 'Waiting for … to answer'", () => {
  const session = new GameSession({ playerColor: "b" }); // AI (White) to move, ply 0
  assert.equal(session.isWaitingForAi, true);
  const idle = describeStatus({ session, connection: pinned, phase: "idle", t: createTranslator("en") });
  assert.doesNotMatch(idle.text, /Waiting for ChatGPT to answer/, "no request is pending — do not say we are waiting");
  assert.equal(idle.text, en["status.aiToMove"].replace("{platform}", "ChatGPT"));
  assert.equal(idle.action, StatusAction.ASK_AI, "the explicit Ask AI recovery is offered");
  // A genuinely pending request keeps the waiting copy.
  const awaiting = describeStatus({ session, connection: pinned, phase: "awaiting", t: createTranslator("en") });
  assert.match(awaiting.text, /Waiting for ChatGPT to answer/);
  // Vietnamese has its own copy.
  const vi = describeStatus({ session, connection: pinned, phase: "idle", t: createTranslator("vi") });
  assert.equal(vi.text, getDictionary("vi")["status.aiToMove"].replace("{platform}", "ChatGPT"));
});

test("panel: a pinned-tab reply nobody asked for (e.g. after the panel reopened) is surfaced, never silently dropped", async () => {
  const env = await bootApp({ storage: { settings: { playerColor: "b" } } });
  try {
    await delay(20);
    assert.equal(env.prompts().length, 0, "nothing is sent at boot");
    assert.doesNotMatch(env.refs.status.textContent, /Waiting for ChatGPT to answer/);
    env.emitRuntimeMessage(
      { type: "AI_MOVE", move: "e2e4", candidates: ["e2e4"], requestId: 1, platform: "chatgpt" },
      { tab: { id: 7 } },
    );
    await until(() => env.refs["what-happened"].hidden === false);
    assert.equal(env.app.session.plyCount, 0, "an unattributable reply never touches the board");
    assert.equal(env.refs["what-happened-detail"].textContent, en["delivery.stale"]);
    assert.equal(env.refs["ask-ai"].hidden, false, "Ask AI is the explicit recovery");
    assert.equal(env.prompts().length, 0, "no automatic resend");
  } finally {
    env.teardown();
  }
});

test("panel: a reply from ANOTHER tab is ignored without disturbing the live request", async () => {
  const env = await bootApp();
  try {
    await env.app.selectSquare(12);
    await env.app.selectSquare(28); // e2e4 → one prompt, awaiting
    const id = env.prompts().at(-1).message.requestId;
    env.emitRuntimeMessage(
      { type: "AI_MOVE", move: "e7e5", candidates: ["e7e5"], requestId: id, platform: "chatgpt" },
      { tab: { id: 99 } },
    );
    await delay(20);
    assert.equal(env.app.session.plyCount, 1, "only the pinned tab may move the board");
    assert.match(env.refs.status.textContent, /Waiting for ChatGPT/, "the live request still waits");
    env.emitRuntimeMessage(
      { type: "AI_MOVE", move: "e7e5", candidates: ["e7e5"], requestId: id, platform: "chatgpt" },
      { tab: { id: 7 } },
    );
    await until(() => env.app.session.plyCount === 2);
  } finally {
    env.teardown();
  }
});

test("panel: a reply that beats the send acknowledgement (phase SENDING) is applied, and the late ack cannot undo it", async () => {
  const env = await bootApp();
  let release;
  const restore = scriptSend(env, () => new Promise((resolve) => (release = resolve)));
  try {
    await env.app.selectSquare(12);
    const pending = env.app.selectSquare(28);
    await until(() => env.prompts().length === 1 && typeof release === "function");
    const id = env.prompts().at(-1).message.requestId;
    env.emitRuntimeMessage(
      { type: "AI_MOVE", move: "e7e5", candidates: ["e7e5"], requestId: id, platform: "chatgpt" },
      { tab: { id: 7 } },
    );
    await until(() => env.app.session.plyCount === 2);
    release({ ok: true, method: "button" });
    await pending;
    await delay(10);
    assert.equal(env.app.session.plyCount, 2);
    assert.match(env.refs.status.textContent, /Your move/i, "the late acknowledgement never restores 'waiting'");
    assert.equal(env.refs["what-happened-detail"].textContent, en["delivery.answered"]);
    // A duplicate delivery of the same reply is inert.
    env.emitRuntimeMessage(
      { type: "AI_MOVE", move: "e7e5", candidates: ["e7e5"], requestId: id, platform: "chatgpt" },
      { tab: { id: 7 } },
    );
    await delay(20);
    assert.equal(env.app.session.plyCount, 2);
    assert.equal(env.refs["what-happened-detail"].textContent, en["delivery.answered"], "ANSWERED is never downgraded");
    assert.equal(env.prompts().length, 1);
  } finally {
    restore();
    env.teardown();
  }
});

test("panel: a genuine no-move reply ends in an honest Ask again state — no substituted move, no silent stall", async () => {
  const env = await bootApp({ storage: { settings: { autoRetry: false } } });
  try {
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    const id = env.prompts().at(-1).message.requestId;
    env.emitRuntimeMessage(
      { type: "CONTENT_STATUS", state: "no-move", noMove: true, text: "", requestId: id, platform: "chatgpt" },
      { tab: { id: 7 } },
    );
    await until(() => env.refs["ask-ai"].hidden === false);
    assert.equal(env.app.session.plyCount, 1, "the local engine never substitutes a move");
    assert.equal(env.refs["ask-ai"].textContent, en["status.askAgain"]);
    assert.equal(env.prompts().length, 1, "Ask again is an explicit user action");
    await env.app.requestAiMove(); // the user presses Ask again
    assert.equal(env.prompts().length, 2);
    assert.match(env.prompts().at(-1).message.prompt, /No usable move arrived|not legal/);
  } finally {
    env.teardown();
  }
});

test("panel: an illegal reply (position desync) names the broken rule and the retry carries the authoritative FEN + legal set", async () => {
  const env = await bootApp({ storage: { settings: { autoRetry: false } } });
  try {
    await env.app.selectSquare(12);
    await env.app.selectSquare(28);
    const id = env.prompts().at(-1).message.requestId;
    const fen = env.app.session.fen;
    env.emitRuntimeMessage(
      { type: "AI_MOVE", move: "e2e4", candidates: ["e2e4"], requestId: id, platform: "chatgpt" },
      { tab: { id: 7 } },
    );
    await until(() => env.refs["ask-ai"].hidden === false);
    assert.equal(env.app.session.plyCount, 1);
    assert.match(env.refs.status.textContent, /e2e4/);
    await env.app.requestAiMove();
    const retry = env.prompts().at(-1).message.prompt;
    assert.ok(retry.includes(`Position (FEN): ${fen}`), "the retry restates the authoritative FEN");
    assert.match(retry, /Legal moves \(20 total\)/, "and the full legal set");
    assert.match(retry, /Previously rejected UCIs \(do not repeat\): e2-e4/);
  } finally {
    env.teardown();
  }
});
