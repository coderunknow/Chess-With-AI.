// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { Mode, canTransition, transitionMode, deriveMode, MODES } from "../src/ui/modes.js";
import { checkInvariants } from "../src/ui/invariants.js";
import { Phase } from "../src/ui/app.js";

test("mode transitions are explicit and exhaustive from PLAY", () => {
  assert.deepEqual(MODES, ["PLAY", "RATED", "BATTLE", "BOT_VS_AI"]);
  assert.equal(canTransition(Mode.PLAY, Mode.BATTLE), true);
  assert.equal(canTransition(Mode.PLAY, Mode.RATED), true);
  assert.equal(canTransition(Mode.PLAY, Mode.BOT_VS_AI), true);
  assert.equal(canTransition(Mode.BATTLE, Mode.RATED), false);
  assert.equal(canTransition(Mode.RATED, Mode.BATTLE), false);
  assert.equal(canTransition(Mode.BOT_VS_AI, Mode.PLAY), true);
  assert.equal(transitionMode(Mode.PLAY, Mode.BOT_VS_AI), Mode.BOT_VS_AI);
  assert.throws(() => transitionMode(Mode.BATTLE, Mode.RATED), /Invalid mode/);
});

test("deriveMode prefers specialised ownership over PLAY", () => {
  assert.equal(deriveMode({}), Mode.PLAY);
  assert.equal(deriveMode({ match: {} }), Mode.RATED);
  assert.equal(deriveMode({ battleState: {} }), Mode.BATTLE);
  assert.equal(deriveMode({ botState: {} }), Mode.BOT_VS_AI);
  // bot outranks battle if both somehow present (should not happen in App)
  assert.equal(deriveMode({ botState: {}, battleState: {}, match: {} }), Mode.BOT_VS_AI);
});

test("mode-owned state cannot leak into the wrong mode", () => {
  assert.deepEqual(checkInvariants({ mode: Mode.PLAY, battleState: {} }), ["mode.battle-owner"]);
  assert.deepEqual(checkInvariants({ mode: Mode.PLAY, match: {} }), ["mode.match-owner"]);
  assert.deepEqual(checkInvariants({ mode: Mode.PLAY, botState: {} }), ["mode.bot-owner"]);
  assert.deepEqual(checkInvariants({ mode: Mode.BATTLE, battleState: {} }), []);
});

test("invariant checker catches request, board, clock, pause, and terminal disagreement", () => {
  // Phase values match App.Phase (lowercase).
  const violations = checkInvariants({
    mode: Mode.PLAY,
    expectedReplyId: "r1",
    phase: Phase.IDLE,
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

test("pending side must match the side to move", () => {
  assert.deepEqual(
    checkInvariants({
      mode: Mode.BATTLE,
      battleState: {},
      expectedReplyId: "r1",
      phase: Phase.AWAITING,
      pendingSide: "b",
      session: { fen: "x", turn: "w" },
    }),
    ["request.side-mismatch"],
  );
  assert.deepEqual(
    checkInvariants({
      mode: Mode.BATTLE,
      battleState: {},
      expectedReplyId: "r1",
      phase: Phase.AWAITING,
      pendingSide: "w",
      session: { fen: "x", turn: "w" },
    }),
    [],
  );
});

test("valid idle PLAY state has no violations", () => {
  assert.deepEqual(
    checkInvariants({
      mode: Mode.PLAY,
      expectedReplyId: null,
      phase: Phase.IDLE,
      session: { fen: "start", turn: "w" },
      renderedFen: "start",
      renderedTurn: "w",
      paused: false,
      gameOver: false,
    }),
    [],
  );
});
