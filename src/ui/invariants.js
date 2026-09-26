// @ts-check
import { Mode } from "./modes.js";

/**
 * Pure, privacy-safe state consistency checks. Callers may report only codes;
 * this module never includes prompts, chat text, or commentary in a violation.
 * @param {any} state
 * @returns {string[]}
 */
export function checkInvariants(state) {
  const violations = [];
  const mode = state?.mode;
  if (!Object.values(Mode).includes(mode)) violations.push("mode.invalid");
  const pending = state?.expectedReplyId != null;
  const phasePending = ["SENDING", "AWAITING", "UNCONFIRMED"].includes(state?.phase);
  if (pending !== phasePending) violations.push("request.phase-mismatch");
  if (mode !== Mode.RATED && state?.match != null) violations.push("mode.match-owner");
  if (mode !== Mode.BATTLE && state?.battleState != null) violations.push("mode.battle-owner");
  if (mode !== Mode.BOT_VS_AI && state?.botState != null) violations.push("mode.bot-owner");
  if (state?.gameOver && (pending || state?.retryTimerActive || state?.clockRunning)) {
    violations.push("terminal.active-work");
  }
  if (state?.paused && (pending || state?.clockRunning || state?.retryTimerActive)) {
    violations.push("paused.active-work");
  }
  if (state?.session && state?.renderedFen != null && state.renderedFen !== state.session.fen) {
    violations.push("board.fen-mismatch");
  }
  if (state?.session && state?.renderedTurn != null && state.renderedTurn !== state.session.turn) {
    violations.push("board.turn-mismatch");
  }
  if (state?.clockRunning && state?.session && state.clockRunning !== state.session.turn) {
    violations.push("clock.turn-mismatch");
  }
  return violations;
}
