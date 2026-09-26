// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { Mode, canTransition, transitionMode } from "../src/ui/modes.js";
import { checkInvariants } from "../src/ui/invariants.js";

test("mode transitions are explicit and mode-owned state cannot leak", () => {
  assert.equal(canTransition(Mode.PLAY, Mode.BATTLE), true);
  assert.equal(canTransition(Mode.BATTLE, Mode.RATED), false);
  assert.equal(transitionMode(Mode.PLAY, Mode.BOT_VS_AI), Mode.BOT_VS_AI);
  assert.throws(() => transitionMode(Mode.BATTLE, Mode.RATED), /Invalid mode/);
  assert.deepEqual(checkInvariants({ mode: Mode.PLAY, battleState: {} }), ["mode.battle-owner"]);
});

test("invariant checker catches request, board, clock, pause, and terminal disagreement", () => {
  const violations = checkInvariants({
    mode: Mode.PLAY,
    expectedReplyId: "r1",
    phase: "IDLE",
    session: { fen: "authoritative", turn: "w" },
    renderedFen: "stale",
    renderedTurn: "b",
    clockRunning: "b",
    paused: true,
    gameOver: true,
    retryTimerActive: true,
  });
  assert.deepEqual(violations, [
    "request.phase-mismatch",
    "terminal.active-work",
    "paused.active-work",
    "board.fen-mismatch",
    "board.turn-mismatch",
    "clock.turn-mismatch",
  ]);
});
