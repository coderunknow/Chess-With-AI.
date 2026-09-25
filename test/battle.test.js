// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/ui/game.js";
import { bootApp, delay } from "./helpers/boot-app.js";
import {
  BATTLE_LEDGER_KEY,
  BATTLE_SNAPSHOT_KEY,
  adjudicateIfNeeded,
  battlePairKey,
  battleRemainingMs,
  completeMove,
  createBattle,
  flagResult,
  pairedPgns,
  recordBattleResult,
  restoreBattle,
  serializeBattle,
  tickBattle,
} from "../src/shared/battle.js";
import { buildMovePrompt } from "../src/shared/prompt.js";

const CHAT = { id: 7, url: "https://chatgpt.com/", title: "ChatGPT", favIconUrl: "" };
const CLAUDE = { id: 8, url: "https://claude.ai/", title: "Claude", favIconUrl: "" };
const OK_REPLY = { ok: true, method: "button", diagnostics: { stages: { submitted: Date.now() } } };

function sendPrompts(state, tabId) {
  return state.tabMessages
    .filter((entry) => entry.tabId === tabId && entry.message?.type === "SEND_CHESS_PROMPT")
    .map((entry) => entry.message);
}

/** Script per-tab SEND_CHESS_PROMPT replies: map of tabId -> queue (last repeats). */
function scriptTabs(state, scripts) {
  const counts = new Map();
  const original = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = async (tabId, message) => {
    // PING/content handshakes stay with the fake; only chess prompts are scripted.
    if (message?.type !== "SEND_CHESS_PROMPT") return original(tabId, message);
    state.tabMessages.push({ tabId, message });
    const queue = scripts.get(tabId);
    if (!queue) return { ok: false, error: "no script" };
    const i = counts.get(tabId) ?? 0;
    counts.set(tabId, i + 1);
    return queue[Math.min(i, queue.length - 1)];
  };
  return counts;
}

const SIDES = {
  w: { tabId: 7, slot: "main", platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
  b: { tabId: 8, slot: "opponent", platformId: "claude", label: "Claude", title: "Claude" },
};

test("battle clock: runs only for the side to move, increment on completion, flag = loss", () => {
  let battle = createBattle({
    sides: SIDES,
    minutesPerSide: 1,
    incrementSec: 3,
    maxPlies: 200,
  });
  assert.equal(battle.status, "running");
  assert.equal(battleRemainingMs(battle.clock, "w"), 60000);
  assert.equal(battleRemainingMs(battle.clock, "b"), 60000);
  assert.equal(battle.clock.running, "w");
  const after = tickBattle(battle, battle.clock.lastTick + 1000);
  battle = after.battle;
  assert.equal(battleRemainingMs(battle.clock, "w"), 59000);
  assert.equal(battleRemainingMs(battle.clock, "b"), 60000);
  assert.equal(after.flaggedSide, null);
  battle = completeMove(battle, "w", battle.clock.lastTick + 500);
  assert.equal(battleRemainingMs(battle.clock, "w"), 59000 + 3000 - 500);
  assert.equal(battleRemainingMs(battle.clock, "b"), 60000);
  assert.equal(battle.clock.running, "b");
  const flag = tickBattle({ ...battle, clock: { ...battle.clock, blackMs: 20, lastTick: 0 } }, 21);
  assert.equal(flag.flaggedSide, "b");
  assert.deepEqual(flagResult(flag.battle, flag.flaggedSide), {
    token: "1-0",
    reason: "flag",
    winner: "w",
  });
  assert.deepEqual(flagResult(flag.battle, "w"), { token: "0-1", reason: "flag", winner: "b" });
});

test("every battle prompt carries the side's remaining time and increment — never stripped by concision", () => {
  for (const style of ["standard", "concise", "efficient", "fun"]) {
    const prompt = buildMovePrompt({
      fen: "8/8/8/4k3/8/3K4/8/8 w - - 0 1",
      history: "1. e4 e5",
      uci: "e7e5",
      san: "e5",
      fullMoveNumber: 2,
      legalUcis: ["d3d4", "d3e3"],
      aiColor: "w",
      style,
      battleClock: { remainingMs: 300000, incrementSec: 3 },
    });
    assert.match(prompt, /You have 05:00 left; your increment is 3s\./);
  }
  const retry = buildRetryForBattleCheck();
  assert.match(retry, /You have 01:05 left; your increment is 2s\./);
});

/** The retry prompt must keep the clock cue too (battle variant contract). */
function buildRetryForBattleCheck() {
  const base = buildMovePrompt({
    fen: "8/8/8/4k3/8/3K4/8/8 w - - 0 1",
    history: "1. e4 e5",
    uci: "e7e5",
    san: "e5",
    fullMoveNumber: 2,
    legalUcis: ["d3d4", "d3e3"],
    aiColor: "w",
    style: "concise",
    battleClock: { remainingMs: 65000, incrementSec: 2 },
  });
  return base;
}

test("GameSession.playBattleReply applies either side strictly as AI moves; promotion kept", () => {
  const session = new GameSession({ playerColor: "w" });
  const e4 = { uci: "e2e4", san: "e4" };
  assert.equal(session.playBattleReply([e4]).ok, true);
  assert.equal(session.history[0].source, "ai");
  assert.equal(session.history[0].uci, "e2e4");
  assert.equal(session.isPlayerTurn, false); // black to move now
  const both = session.playBattleReply([
    { uci: "e7e5", san: "e5" },
    { uci: "zz9zz9", san: "" },
  ]);
  // The FIRST legal candidate wins (mirror of the one-parse contract).
  assert.equal(both.ok, true);
  assert.equal(session.history[1].uci, "e7e5");
  assert.equal(session.history[1].source, "ai");
  assert.equal(session.isPlayerTurn, true); // white again
  // Illegal-only input never mutates.
  const illegal = session.playBattleReply([{ uci: "e7e5", san: "e5" }]);
  assert.equal(illegal.ok, false);
  assert.equal(session.plyCount, 2);
  // Strict promotion: the underpromotion square is reachable later without
  // queen defaulting from the chat protocol (missing promotion is rejected).
  assert.equal(illegal.legalUcis.includes("e7e5"), false);
});

test("ledger records W-D-L per ordered tab-pair; aborted battles leave no entry; adjudicated draw at max plies", () => {
  assert.equal(battlePairKey(SIDES), "chatgpt#7|claude#8");
  const battle = createBattle({ sides: SIDES, minutesPerSide: 5, incrementSec: 0, maxPlies: 2 });
  // At max plies with the game unfinished → adjudicated draw (the only draw
  // battle may invent — the banner must say adjudicated).
  assert.deepEqual(adjudicateIfNeeded(battle, 2), {
    token: "1/2-1/2",
    reason: "adjudicated",
    winner: null,
  });
  assert.equal(adjudicateIfNeeded(battle, 1), null);

  let ledger = {};
  ledger = recordBattleResult(ledger, {
    pairKey: battlePairKey(SIDES),
    sides: SIDES,
    result: { token: "1-0", reason: "checkmate", winner: "w" },
    clocksMs: { whiteMs: 120000, blackMs: 0 },
    date: "2026-09-25T00:00:00Z",
  });
  ledger = recordBattleResult(ledger, {
    pairKey: battlePairKey(SIDES),
    sides: SIDES,
    result: { token: "1/2-1/2", reason: "adjudicated", winner: null },
    clocksMs: { whiteMs: 10, blackMs: 10 },
    date: "2026-09-25T01:00:00Z",
  });
  ledger = recordBattleResult(ledger, {
    pairKey: battlePairKey(SIDES),
    sides: SIDES,
    result: { token: "0-1", reason: "flag", winner: "b" },
    clocksMs: { whiteMs: 0, blackMs: 33 },
    date: "2026-09-25T02:00:00Z",
  });
  const pair = ledger[battlePairKey(SIDES)];
  assert.deepEqual([pair.whiteWins, pair.draws, pair.blackWins], [1, 1, 1]);
  assert.equal(pair.history.length, 3);
  // Aborted-unfinished battles never reach recordBattleResult — the director
  // simply doesn't call it (asserted at the app level).
});

test("paired PGN export names both tabs from both perspectives and stays UNRATED", () => {
  const session = new GameSession({ playerColor: "w" });
  session.playBattleReply([{ uci: "e2e4", san: "e4" }]);
  session.playBattleReply([{ uci: "e7e5", san: "e5" }]);
  const battle = createBattle({ sides: SIDES, minutesPerSide: 5, incrementSec: 0, maxPlies: 200 });
  const pgns = pairedPgns(battle, session);
  for (const perspective of ["w", "b"]) {
    assert.match(pgns[perspective], /White "ChatGPT/);
    assert.match(pgns[perspective], /Black "Claude/);
    assert.match(pgns[perspective], /1\. e4 e5/);
    assert.match(pgns[perspective], /UNRATED/);
    assert.match(pgns[perspective], /perspective/);
  }
});

test("battle snapshot restore comes back PAUSED — never auto-continue", () => {
  const session = new GameSession({ playerColor: "w" });
  session.playBattleReply([{ uci: "e2e4", san: "e4" }]);
  const battle = createBattle({ sides: SIDES, minutesPerSide: 5, incrementSec: 0, maxPlies: 200 });
  const snapshot = serializeBattle(battle, session);
  const restored = restoreBattle(snapshot);
  assert.equal(restored.battle.status, "paused");
  assert.deepEqual(restored.sessionSnapshot.moves, ["e2e4"]);
});

test("two-tab turn-taking: both AI tabs alternate sends and the local engine never moves", async () => {
  const { app, state, emitRuntimeMessage, teardown } = await bootApp({
    tabs: [CHAT, CLAUDE],
    pin: { tabId: CHAT.id, platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
  });
  try {
    scriptTabs(
      state,
      new Map([
        [CHAT.id, [OK_REPLY]],
        [CLAUDE.id, [OK_REPLY]],
      ]),
    );
    const started = await app.startBattle({
      opponentTabId: CLAUDE.id,
      opponentColor: "b",
      minutesPerSide: 5,
      incrementSec: 0,
      maxPlies: 200,
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    await delay(25);
    // main side (ChatGPT) is white here → first prompt goes to the main tab.
    const chatSends = sendPrompts(state, CHAT.id);
    assert.equal(chatSends.length, 1, "white side (main tab) got the first prompt");
    assert.equal(chatSends[0].id, "battle-move");
    assert.match(chatSends[0].message.prompt, /You have 05:00 left; your increment is 0s\./);
    await emitRuntimeMessage(
      { type: "AI_MOVE", requestId: chatSends[0].requestId, move: "e2e4", copied: false },
      { tab: { id: CHAT.id } },
    );
    await delay(25);
    const claudeSends = sendPrompts(state, CLAUDE.id);
    assert.equal(claudeSends.length, 1, "black side (opponent tab) got the turn prompt");
    assert.match(claudeSends[0].message.prompt, /The other AI just played e4 \(\[e2e4\]\)/);
    await emitRuntimeMessage(
      { type: "AI_MOVE", requestId: claudeSends[0].requestId, move: "e7e5", copied: false },
      { tab: { id: CLAUDE.id } },
    );
    await delay(25);
    assert.equal(sendPrompts(state, CHAT.id).length, 2);
    const battleState = app.__battleState();
    assert.deepEqual(battleState.sessionSnapshot.moves, ["e2e4", "e7e5"]);
    assert.deepEqual(battleState.moveSources, ["ai", "ai"], "the local engine NEVER plays a battle move");
    // One submit per prompt per tab: no hidden re-dispatch per turn.
    assert.equal(sendPrompts(state, CLAUDE.id).length, 1);
  } finally {
    teardown();
  }
});

test("opponent slot lifecycle: created at start, torn down at end, never leaks into the main pin", async () => {
  const { app, state, teardown } = await bootApp({
    tabs: [CHAT, CLAUDE],
    pin: { tabId: CHAT.id, platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
  });
  try {
    scriptTabs(
      state,
      new Map([
        [CHAT.id, [OK_REPLY]],
        [CLAUDE.id, [OK_REPLY]],
      ]),
    );
    const started = await app.startBattle({
      opponentTabId: CLAUDE.id,
      opponentColor: "b",
      minutesPerSide: 1,
      incrementSec: 0,
      maxPlies: 20,
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    await delay(25);
    const main = await chrome.runtime.sendMessage({ type: "GET_CONNECTIONS" });
    const opponent = await chrome.runtime.sendMessage({
      type: "GET_CONNECTIONS",
      slot: "opponent",
    });
    assert.equal(main?.pin?.tabId, CHAT.id, "main pin untouched");
    assert.equal(opponent?.pin?.tabId, CLAUDE.id, "opponent slot holds exactly the battle tab");
    await app.abortBattle();
    await delay(25);
    const mainAfter = await chrome.runtime.sendMessage({ type: "GET_CONNECTIONS" });
    const opponentAfter = await chrome.runtime.sendMessage({
      type: "GET_CONNECTIONS",
      slot: "opponent",
    });
    assert.equal(mainAfter?.pin?.tabId, CHAT.id, "main pin survives teardown");
    assert.equal(opponentAfter?.pin ?? null, null, "opponent slot empty again");
  } finally {
    teardown();
  }
});

test("illegal reply after max retries pauses the battle — no fabricated move ever", async () => {
  const { app, state, emitRuntimeMessage, teardown } = await bootApp({
    tabs: [CHAT, CLAUDE],
    pin: { tabId: CHAT.id, platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
  });
  try {
    await app.updateSettings({ maxRetries: 2 });
    scriptTabs(
      state,
      new Map([
        [CHAT.id, [OK_REPLY]],
        [CLAUDE.id, [OK_REPLY]],
      ]),
    );
    const started = await app.startBattle({
      opponentTabId: CLAUDE.id,
      opponentColor: "w", // opponent (claude) plays white → first reply comes from CLAUDE
      minutesPerSide: 1,
      incrementSec: 0,
      maxPlies: 20,
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    await delay(25);
    assert.equal(sendPrompts(state, CLAUDE.id).length, 1);
    // Initial reply illegal → bounded corrective retries (2) → still illegal → PAUSE.
    for (let i = 0; i < 3; i += 1) {
      const sends = sendPrompts(state, CLAUDE.id);
      await emitRuntimeMessage(
        {
          type: "AI_MOVE",
          requestId: sends[sends.length - 1].requestId,
          move: "zz9zz9",
          copied: false,
        },
        { tab: { id: CLAUDE.id } },
      );
      await delay(25);
    }
    assert.equal(sendPrompts(state, CLAUDE.id).length, 3, "1 initial + exactly maxRetries retries");
    const battleState = app.__battleState();
    assert.equal(battleState.paused, true);
    assert.equal(battleState.sessionSnapshot.moves.length, 0, "no move was fabricated");
    assert.equal(battleState.moveSources.length, 0);
    assert.match(battleState.pauseReason, /illegal/i);
  } finally {
    teardown();
  }
});

test("unconfirmed delivery pauses the battle with per-side detail — no auto resend", async () => {
  const { app, state, teardown } = await bootApp({
    tabs: [CHAT, CLAUDE],
    pin: { tabId: CHAT.id, platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
  });
  try {
    scriptTabs(
      state,
      new Map([
        [CHAT.id, [{ ok: false, unconfirmed: true, diagnostics: { stages: { submitted: Date.now() } } }]],
        [CLAUDE.id, [OK_REPLY]],
      ]),
    );
    const started = await app.startBattle({
      opponentTabId: CLAUDE.id,
      opponentColor: "b",
      minutesPerSide: 1,
      incrementSec: 0,
      maxPlies: 20,
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    await delay(35);
    assert.equal(sendPrompts(state, CHAT.id).length, 1, "exactly one submit — never a hidden resend");
    const battleState = app.__battleState();
    assert.equal(battleState.paused, true);
    assert.match(battleState.pauseReason, /ChatGPT/);
    assert.match(battleState.pauseReason, /confirm/i);
  } finally {
    teardown();
  }
});

test("flag fall ends the battle immediately, even with a send in flight", async () => {
  const { app, state, teardown } = await bootApp({
    tabs: [CHAT, CLAUDE],
    pin: { tabId: CHAT.id, platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
  });
  try {
    // White's send never resolves quickly (simulates a send in flight).
    const originalSend = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = async (tabId, message) => {
      if (message?.type !== "SEND_CHESS_PROMPT") return originalSend(tabId, message);
      state.tabMessages.push({ tabId, message });
      await delay(400);
      return OK_REPLY;
    };
    const started = await app.startBattle({
      opponentTabId: CLAUDE.id,
      opponentColor: "b",
      minutesPerSide: 1,
      incrementSec: 0,
      maxPlies: 20,
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    await delay(25);
    // White is thinking; drain white's clock to zero and tick the battle clock.
    const forced = app.__battleTest({ clock: { whiteMs: 0 }, now: Date.now() + 1 });
    assert.equal(forced.result.reason, "flag");
    assert.equal(forced.result.token, "0-1");
    assert.equal(forced.status, "finished");
    // The in-flight send is invalidated (epoch bump): its late resolution can
    // never resume or mutate the finished battle.
    await delay(450);
    const after = app.__battleState();
    assert.equal(after.sessionSnapshot.moves.length, 0);
    assert.equal(after.finished, true);
    assert.equal(after.result.reason, "flag");
    assert.equal(sendPrompts(state, CHAT.id).length, 1);
  } finally {
    teardown();
  }
});

test("manual send mode refuses battle start and offers an explicit switch — rated copy stays separate", async () => {
  const { app, teardown } = await bootApp({
    tabs: [CHAT, CLAUDE],
    pin: { tabId: CHAT.id, platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
  });
  try {
    await app.updateSettings({ sendMode: "manual" });
    const started = await app.startBattle({
      opponentTabId: CLAUDE.id,
      opponentColor: "b",
      minutesPerSide: 1,
      incrementSec: 0,
      maxPlies: 20,
    });
    assert.equal(started.ok, false);
    assert.equal(started.reason, "manual");
    assert.equal(started.canEnableAuto, true);
    assert.match(app.message, /Auto/i);
    // The switch is an explicit user action — nothing switched silently.
    assert.equal(app.settings.sendMode, "manual");
    await app.enableAutoSend();
    assert.equal(app.settings.sendMode, "auto");
  } finally {
    teardown();
  }
});

test("restart mid-battle restores paused with Resume — never auto-continues sends", async () => {
  const first = await bootApp({
    tabs: [CHAT, CLAUDE],
    pin: { tabId: CHAT.id, platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
  });
  const state = first.state;
  try {
    scriptTabs(
      state,
      new Map([
        [CHAT.id, [OK_REPLY]],
        [CLAUDE.id, [OK_REPLY]],
      ]),
    );
    const started = await first.app.startBattle({
      opponentTabId: CLAUDE.id,
      opponentColor: "b",
      minutesPerSide: 5,
      incrementSec: 0,
      maxPlies: 200,
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    await delay(25);
    assert.equal(sendPrompts(state, CHAT.id).length, 1);
    first.app.dispose();
    first.teardown();
  } catch (error) {
    first.teardown();
    throw error;
  }
  // Fresh boot with the same persisted storage — battle snapshot survives.
  const second = await bootApp({
    tabs: [CHAT, CLAUDE],
    pin: { tabId: CHAT.id, platformId: "chatgpt", label: "ChatGPT", title: "ChatGPT" },
    storage: { ...state.storageData },
  });
  try {
    const snapshot = state.storageData[BATTLE_SNAPSHOT_KEY];
    assert.ok(snapshot, "battle snapshot persisted");
    const sendsBefore = sendPrompts(state, CHAT.id).length;
    await delay(25);
    const restored = second.app.__battleState();
    assert.ok(restored, "battle restored");
    assert.equal(restored.paused, true, "restore is ALWAYS paused");
    assert.equal(sendPrompts(state, CHAT.id).length, sendsBefore, "no send ever auto-continues on load");
    assert.equal(state.storageData[BATTLE_LEDGER_KEY] ?? null, null);
  } finally {
    second.teardown();
  }
});
