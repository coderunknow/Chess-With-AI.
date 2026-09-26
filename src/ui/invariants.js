// @ts-check
/**
 * Pure, privacy-safe state consistency checks. Callers may report only codes;
 * this module never includes prompts, chat text, or commentary in a violation.
 *
 * Phase values match {@link import('./app.js').Phase} (lowercase strings).
 *
 * @module ui/invariants
 */

import { Mode, MODES } from "./modes.js";

/** Phases that imply a live outbound request is outstanding. */
const PENDING_PHASES = Object.freeze(["sending", "awaiting", "unconfirmed"]);

/**
 * @param {any} state
 * @returns {string[]} violation codes only — never free-form text.
 */
export function checkInvariants(state) {
  const violations = [];
  const mode = state?.mode;
  if (!MODES.includes(mode)) violations.push("mode.invalid");

  const pending = state?.expectedReplyId != null;
  const phasePending = PENDING_PHASES.includes(state?.phase);
  if (pending !== phasePending) violations.push("request.phase-mismatch");

  // Mode ownership: specialised state may only exist under its own mode.
  if (mode !== Mode.RATED && state?.match != null) violations.push("mode.match-owner");
  if (mode !== Mode.BATTLE && state?.battleState != null) violations.push("mode.battle-owner");
  if (mode !== Mode.BOT_VS_AI && state?.botState != null) violations.push("mode.bot-owner");

  // Pending request must belong to the side to move when a session is present.
  if (
    pending &&
    state?.pendingSide != null &&
    state?.session?.turn != null &&
    state.pendingSide !== state.session.turn
  ) {
    violations.push("request.side-mismatch");
  }

  if (state?.gameOver && (pending || state?.retryTimerActive || state?.clockRunning || state?.engineSearching)) {
    violations.push("terminal.active-work");
  }
  if (state?.paused && (pending || state?.clockRunning || state?.retryTimerActive || state?.engineSearching)) {
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
