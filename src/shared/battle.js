// @ts-check
// AI-vs-AI battles: clocked, UNRATED games between two pinned AI tabs. The
// battle game is owned by GameSession exactly like a normal game — the local
// engine NEVER plays a move in battle. This module is pure battle bookkeeping
// (clocks, results, ledger, snapshots); all chess truth lives in GameSession.

import { formatPgn } from "../core/pgn.js";

/**
 * Battle clocks share the ClockState shape but take explicit `nowMs` values so
 * battle timing is deterministic and testable (the shared clock module is
 * immutable and wall-clock based — kept untouched for v0.6 compat).
 * @typedef {{whiteMs: number, blackMs: number, running: "w"|"b"|null, lastTick: number}} BattleClock
 * @param {number} ms
 * @returns {BattleClock}
 */
function createBattleClock(ms) {
  return { whiteMs: ms, blackMs: ms, running: null, lastTick: 0 };
}
function runningMs(/** @type {BattleClock} */ clock, /** @type {number} */ nowMs) {
  return clock.running && nowMs > clock.lastTick ? nowMs - clock.lastTick : 0;
}
function deduct(/** @type {BattleClock} */ clock, /** @type {number} */ nowMs) {
  const delta = runningMs(clock, nowMs);
  if (!clock.running) return clock;
  if (clock.running === "w") clock.whiteMs = Math.max(0, clock.whiteMs - delta);
  else clock.blackMs = Math.max(0, clock.blackMs - delta);
  clock.lastTick = Math.max(clock.lastTick, nowMs);
  return clock;
}

export const BATTLE_SNAPSHOT_KEY = "battleSnapshot";
export const BATTLE_LEDGER_KEY = "battleLedger";
export const MAX_PAIR_HISTORY = 50;
export const RESULT_TOKENS = ["1-0", "0-1", "1/2-1/2"];

/**
 * @typedef {{tabId: number, slot: "main"|"opponent", platformId: string, label: string, title: string}} BattleSide
 * @typedef {{token: string, reason: "checkmate"|"resignation"|"flag"|"draw"|"adjudicated"|"aborted", winner: "w"|"b"|null}} BattleResult
 * @typedef {ReturnType<typeof createBattle>} Battle
 */

/**
 * A battle is created when the user starts one and torn down when it ends.
 * @param {{sides: {w: BattleSide, b: BattleSide}, minutesPerSide: number, incrementSec: number, maxPlies: number}} options
 */
export function createBattle({ sides, minutesPerSide, incrementSec, maxPlies }) {
  const clock = createBattleClock(minutesPerSide * 60000);
  clock.running = "w";
  clock.lastTick = Date.now();
  return {
    id: `battle-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    sides,
    minutesPerSide,
    incrementSec,
    maxPlies,
    clock,
    status: /** @type {"running"|"paused"|"finished"} */ ("running"),
    result: /** @type {BattleResult|null} */ (null),
    retries: { w: 0, b: 0 },
  };
}

/** @param {ReturnType<typeof createClock>} clock @param {"w"|"b"} side */
export function battleRemainingMs(clock, side) {
  return side === "w" ? clock.whiteMs : clock.blackMs;
}

/**
 * Tick the running side's clock (deterministic, explicit time). Returns the
 * battle and the flagged side, if any — a flag is a LOSS immediately, even
 * mid-send.
 * @param {Battle} battle
 * @param {number} nowMs
 */
export function tickBattle(battle, nowMs) {
  const clock = deduct(battle.clock, nowMs);
  let flaggedSide = null;
  if (clock.whiteMs <= 0) {
    clock.whiteMs = 0;
    flaggedSide = "w";
  } else if (clock.blackMs <= 0) {
    clock.blackMs = 0;
    flaggedSide = "b";
  }
  return { battle, flaggedSide };
}

/**
 * Move completion for `side`: that clock stops, the increment lands on the
 * mover, and the other side's clock starts.
 * @param {Battle} battle
 * @param {"w"|"b"} side
 * @param {number} nowMs
 */
export function completeMove(battle, side, nowMs) {
  const other = side === "w" ? "b" : "w";
  const clock = deduct(battle.clock, nowMs);
  clock.running = null;
  if (side === "w") clock.whiteMs += battle.incrementSec * 1000;
  else clock.blackMs += battle.incrementSec * 1000;
  clock.running = other;
  clock.lastTick = nowMs;
  return battle;
}

/** Pause: the running clock stops where it is (soft pause — no flag on pause). */
export function pauseBattleClock(battle, nowMs) {
  deduct(battle.clock, nowMs);
  battle.clock.running = null;
  return battle;
}

/** Resume: the side to move's clock starts again. */
export function resumeBattleClock(battle, side, nowMs) {
  battle.clock.running = side;
  battle.clock.lastTick = nowMs;
  return battle;
}

/** @param {"w"|"b"} flaggedSide @returns {BattleResult} */
export function flagResult(_battle, flaggedSide) {
  return {
    token: flaggedSide === "w" ? "0-1" : "1-0",
    reason: "flag",
    winner: flaggedSide === "w" ? "b" : "w",
  };
}

/**
 * The ONLY draw battle may invent: at max plies with the game unfinished the
 * result is an adjudicated draw and the banner must say so. Never touches
 * (checkmate/stalemate/threefold/insufficient).
 * @param {Battle} battle
 * @param {number} plyCount
 * @returns {BattleResult|null}
 */
export function adjudicateIfNeeded(battle, plyCount) {
  if (battle.status === "finished") return null;
  if (plyCount < battle.maxPlies) return null;
  return { token: "1/2-1/2", reason: "adjudicated", winner: null };
}

/** Resignation: the side to move (its AI) aborts with a reason. */
/** @param {"w"|"b"} resigning */
export function resignationResult(resigning) {
  return {
    token: resigning === "w" ? "0-1" : "1-0",
    reason: "resignation",
    winner: resigning === "w" ? "b" : "w",
  };
}

/** Checkmate/stalemate draw results pass through GameSession's own verdicts. */
/** @param {string} token @param {"w"|"b"|null} winner */
export function gameEndResult(token, winner, reason = "checkmate") {
  return {
    token,
    reason: /** @type {BattleResult["reason"]} */ (reason),
    winner,
  };
}

/**
 * @param {Battle} battle
 * @param {BattleResult} result
 */
export function finishBattle(battle, result) {
  battle.status = "finished";
  battle.result = result;
  battle.clock.running = null;
  return battle;
}

/** Ordered tab-pair key: white side first — platform#tab|platform#tab. */
/** @param {{w: BattleSide, b: BattleSide}} sides */
export function battlePairKey(sides) {
  return `${sides.w.platformId}#${sides.w.tabId}|${sides.b.platformId}#${sides.b.tabId}`;
}

/**
 * W-D-L ledger per ordered tab-pair + bounded history. Aborted-unfinished
 * battles NEVER reach this function (the director simply doesn't call it).
 * @param {Record<string, any>} ledger
 * @param {{pairKey: string, sides: any, result: BattleResult, clocksMs: {whiteMs: number, blackMs: number}, date: string}} entry
 */
export function recordBattleResult(ledger, entry) {
  const pair = ledger[entry.pairKey] ?? {
    sides: entry.sides,
    whiteWins: 0,
    draws: 0,
    blackWins: 0,
    history: [],
  };
  if (entry.result.token === "1-0") pair.whiteWins += 1;
  else if (entry.result.token === "0-1") pair.blackWins += 1;
  else pair.draws += 1;
  pair.history.unshift({
    result: entry.result,
    clocksMs: entry.clocksMs,
    date: entry.date,
  });
  if (pair.history.length > MAX_PAIR_HISTORY) pair.history.length = MAX_PAIR_HISTORY;
  return { ...ledger, [entry.pairKey]: pair };
}

/**
 * Paired PGN export — one PGN per side's perspective, each naming BOTH tabs
 * truthfully in the White/Black headers (perspective marked in Annotator).
 * Battles are always labelled UNRATED — rated copy stays separate.
 * @param {Battle} battle
 * @param {{history: Array<{san: string}>, snapshot: () => any}} session
 * @returns {{w: string, b: string}}
 */
export function pairedPgns(battle, session) {
  const result = battle.result?.token ?? "*";
  const makePgn = (/** @type {string} */ annotator) =>
    formatPgn({
      initialFen: session.snapshot().initialFen,
      san: session.history.map((m) => m.san),
      result,
      headers: {
        Event: "AI Chess Companion battle (UNRATED)",
        Site: `Browser (${battle.sides.w.platformId} vs ${battle.sides.b.platformId})`,
        Date: new Date(battle.createdAt).toISOString().slice(0, 10).replace(/-/g, "."),
        Round: "1",
        White: `${battle.sides.w.label} — tab ${battle.sides.w.tabId} (${battle.sides.w.platformId})`,
        Black: `${battle.sides.b.label} — tab ${battle.sides.b.tabId} (${battle.sides.b.platformId})`,
        Annotator: annotator,
      },
    });
  return {
    w: makePgn(`${battle.sides.w.label}'s perspective (UNRATED)`),
    b: makePgn(`${battle.sides.b.label}'s perspective (UNRATED)`),
  };
}

/**
 * Serialise a battle + its GameSession for persistence. Restore ALWAYS comes
 * back PAUSED — sends never auto-continue on load.
 * @param {Battle} battle
 * @param {{snapshot: () => any}} session
 */
export function serializeBattle(battle, session) {
  return {
    version: 1,
    savedAt: Date.now(),
    battle: { ...battle, clock: { ...battle.clock, running: null } },
    sessionSnapshot: session.snapshot(),
  };
}

/** @param {any} snapshot */
export function restoreBattle(snapshot) {
  const battle = { ...snapshot.battle };
  battle.status = "paused";
  return { battle, sessionSnapshot: snapshot.sessionSnapshot };
}
