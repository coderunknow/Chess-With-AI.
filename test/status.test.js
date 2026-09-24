import assert from "node:assert/strict";
import test from "node:test";

import { GameSession } from "../src/ui/game.js";
import { DeliveryState, StatusAction, describeDelivery, describeStatus } from "../src/ui/status.js";
import { createTranslator } from "../src/shared/i18n.js";

/** @returns {import('../src/ui/game.js').GameSession} a fresh session. */
function liveSession(options = {}) {
  return new GameSession(options);
}

const pinned = { supported: true, platform: "chatgpt", label: "ChatGPT", tabId: 7 };
const unpinned = { supported: false, platform: "", label: "", tabId: null };

test("a finished game keeps its outcome even when a late send error arrives", () => {
  const session = liveSession();
  // Fool's mate: 1. f3 e5 2. g4 Qh4#
  assert.equal(session.playHumanMove("f2f3").ok, true);
  assert.equal(session.playAiMove("e7e5").ok, true);
  assert.equal(session.playHumanMove("g2g4").ok, true);
  assert.equal(session.playAiMove("d8h4").ok, true);
  assert.equal(session.isGameOver, true);

  const translator = createTranslator("en");
  for (const phase of ["error", "sending", "idle", "unconfirmed"]) {
    const status = describeStatus({
      session,
      connection: pinned,
      phase,
      message: "Could not submit the prompt. Send it manually to continue.",
      t: translator,
    });
    assert.match(status.text, /Checkmate/, `phase=${phase} must show the real outcome`);
    assert.doesNotMatch(status.text, /Could not submit/i, `phase=${phase} must not resurrect a stale error`);
    assert.equal(status.action, StatusAction.NEW_GAME, `phase=${phase} must offer New game, not Copy/Ask`);
  }
});

test("the outcome also wins in Vietnamese", () => {
  const session = liveSession();
  assert.equal(session.playHumanMove("f2f3").ok, true);
  assert.equal(session.playAiMove("e7e5").ok, true);
  assert.equal(session.playHumanMove("g2g4").ok, true);
  assert.equal(session.playAiMove("d8h4").ok, true);
  const status = describeStatus({
    session,
    connection: pinned,
    phase: "error",
    message: "Could not submit the prompt. Send it manually to continue.",
    t: createTranslator("vi"),
  });
  assert.match(status.text, /Chiếu hết/);
  assert.equal(status.action, StatusAction.NEW_GAME);
});

test("waiting for the AI stays a waiting state even while the AI king is in check", () => {
  // Black to move and in check; the human plays White and awaits the reply.
  const session = new GameSession({ playerColor: "w", initialFen: "4k3/8/8/8/8/8/4R3/6K1 b - - 0 1" });
  assert.equal(session.isWaitingForAi, true);
  const status = describeStatus({
    session,
    connection: pinned,
    phase: "awaiting",
    t: createTranslator("en"),
  });
  assert.equal(status.kind, "waiting");
  assert.match(status.text, /Waiting for ChatGPT/);
  assert.doesNotMatch(status.text, /in check/i, "the human is not in check; the pending state is what matters");
});

test("your own check is shown only on your turn, not while awaiting a reply", () => {
  // Black owes a reply while its own king is checked by the rook on the e-file.
  const awaiting = new GameSession({ playerColor: "w", initialFen: "4k3/8/8/8/8/8/4R3/6K1 b - - 0 1" });
  const waiting = describeStatus({
    session: awaiting,
    connection: pinned,
    phase: "awaiting",
    t: createTranslator("en"),
  });
  assert.match(waiting.text, /Waiting for/);

  // White is in check and it is White's turn to escape.
  const yourTurn = new GameSession({ playerColor: "w", initialFen: "4k3/8/8/8/8/8/4r3/4K3 w - - 0 1" });
  const check = describeStatus({ session: yourTurn, connection: pinned, phase: "idle", t: createTranslator("en") });
  assert.match(check.text, /in check/);
  assert.equal(check.action, StatusAction.NONE, "a check is not an error and needs no recovery action");
});

test("sending a prompt while the game is still live reports waiting, not an outcome", () => {
  const session = liveSession();
  assert.equal(session.playHumanMove("e2e4").ok, true);
  const status = describeStatus({
    session,
    connection: pinned,
    phase: "sending",
    t: createTranslator("en"),
  });
  assert.equal(status.kind, "waiting");
  assert.match(status.text, /Sending your move to ChatGPT/);
});

test("actionFor never offers Copy/Ask over a finished board", () => {
  const session = liveSession();
  assert.equal(session.playHumanMove("f2f3").ok, true);
  assert.equal(session.playAiMove("e7e5").ok, true);
  assert.equal(session.playHumanMove("g2g4").ok, true);
  assert.equal(session.playAiMove("d8h4").ok, true);
  for (const diagnosticsError of ["", "Could not find the chat input box.", "content script not found"]) {
    const status = describeStatus({
      session,
      connection: pinned,
      phase: "error",
      message: "boom",
      diagnosticsError,
      t: createTranslator("en"),
    });
    assert.equal(status.action, StatusAction.NEW_GAME);
  }
});

test("unpinned awaiting still offers Open an AI chat", () => {
  const session = liveSession();
  assert.equal(session.playHumanMove("e2e4").ok, true);
  const status = describeStatus({
    session,
    connection: unpinned,
    phase: "awaiting",
    t: createTranslator("en"),
  });
  assert.equal(status.action, StatusAction.OPEN_AI);
});

test("delivery descriptions are plain-language and privacy safe", () => {
  const t = createTranslator("en");
  assert.equal(describeDelivery(null, t), "", "no send yet means nothing to explain");
  const never = describeDelivery({ state: DeliveryState.NEVER }, t);
  assert.match(never, /never/i);
  assert.doesNotMatch(never, /FEN|prompt text|transcript/i, "no prompt content leaks into the summary");
  const attempted = describeDelivery({ state: DeliveryState.UNCONFIRMED }, t);
  assert.match(attempted, /attempt/i);
  assert.match(attempted, /check/i);
  assert.match(describeDelivery({ state: DeliveryState.CONFIRMED }, t), /confirmed/i);
  assert.match(describeDelivery({ state: DeliveryState.ANSWERED }, t), /replied|answered/i);
  assert.match(describeDelivery({ state: DeliveryState.STALE }, t), /ignored/i);
  const vi = describeDelivery({ state: DeliveryState.UNCONFIRMED }, createTranslator("vi"));
  assert.doesNotMatch(vi, /^delivery\./, "Vietnamese lookup must resolve");
});
