/**
 * Status line model.
 *
 * Turns the app's state (session, connection, prompt phase) into the single line
 * of text the user sees, plus the colour it should use and whether an action is
 * offered. Pure and therefore unit-tested.
 *
 * @module ui/status
 */

import { Color } from "../core/pieces.js";

/** Visual tone of the status line. */
export const StatusKind = Object.freeze({
  INFO: "info",
  SUCCESS: "success",
  WAITING: "waiting",
  ERROR: "error",
});

/** What the user can do about the current status. */
export const StatusAction = Object.freeze({
  NONE: "",
  ASK_AI: "ask-ai",
  OPEN_AI: "open-ai",
  RETRY: "retry",
  NEW_GAME: "new-game",
});

/**
 * @typedef {object} StatusInput
 * @property {import('./game.js').GameSession} session
 * @property {{supported: boolean, platform: string, label: string}} connection
 * @property {'idle'|'sending'|'awaiting'|'error'} phase
 * @property {string} [message] free-form override, e.g. a specific error.
 * @property {boolean} [busy] true while a prompt is being injected.
 */

/**
 * @typedef {object} Status
 * @property {string} text
 * @property {'info'|'success'|'waiting'|'error'} kind
 * @property {''|'ask-ai'|'open-ai'|'retry'|'new-game'} action
 */

/**
 * @param {StatusInput} input
 * @returns {Status}
 */
export function describeStatus({ session, connection, phase, message = "", busy = false }) {
  if (phase === "error" && message) {
    return status(message, StatusKind.ERROR, actionFor(session, connection));
  }

  if (busy || phase === "sending") {
    return status(`Sending your move to ${connection.label || "the AI"}…`, StatusKind.WAITING);
  }

  if (session.isGameOver) {
    return status(describeOutcome(session), StatusKind.INFO, StatusAction.NEW_GAME);
  }

  if (message) {
    return status(message, StatusKind.INFO);
  }

  if (phase === "awaiting" || session.isWaitingForAi) {
    const opponent = sideLabel(session.aiColor, connection);
    if (!connection.supported) {
      return status(
        `It is ${opponent}'s turn, but no AI chat is open. Open a supported AI to keep playing.`,
        StatusKind.WAITING,
        StatusAction.OPEN_AI,
      );
    }
    return status(`Waiting for ${connection.label} to answer…`, StatusKind.WAITING);
  }

  if (session.isCheck) {
    return status("You are in check — only legal escapes are shown.", StatusKind.ERROR);
  }

  if (!connection.supported) {
    return status(
      "No AI chat detected. Open one of the supported AI chats to play.",
      StatusKind.INFO,
      StatusAction.OPEN_AI,
    );
  }

  return status(
    `Your move. Playing as ${session.playerColor === Color.WHITE ? "White" : "Black"}.`,
    StatusKind.SUCCESS,
  );
}

/**
 * @param {import('./game.js').GameSession} session
 * @returns {string} a description of the finished game.
 */
export function describeOutcome(session) {
  const outcome = session.outcome;
  const mover = session.playerColor === Color.WHITE ? "White" : "Black";

  switch (outcome.reason) {
    case "checkmate":
      return outcome.winner === session.playerColor
        ? `Checkmate — you win as ${mover}! ${outcome.result}`
        : `Checkmate — the AI wins. ${outcome.result}`;
    case "stalemate":
      return `Draw by stalemate. ${outcome.result}`;
    case "fifty-move":
      return `Draw by the fifty-move rule. ${outcome.result}`;
    case "insufficient-material":
      return `Draw — not enough material to mate. ${outcome.result}`;
    case "threefold-repetition":
      return `Draw by threefold repetition. ${outcome.result}`;
    default:
      return "The game is over.";
  }
}

/**
 * @param {StatusInput} input
 * @returns {'ask-ai'|'open-ai'|'retry'|'new-game'|''} the primary action offered.
 */
export function actionFor(session, connection) {
  if (session.isGameOver) {
    return StatusAction.NEW_GAME;
  }
  if (!connection.supported) {
    return session.isWaitingForAi ? StatusAction.OPEN_AI : StatusAction.NONE;
  }
  if (session.isWaitingForAi) {
    return StatusAction.ASK_AI;
  }
  return StatusAction.NONE;
}

/**
 * @param {string} text
 * @param {string} kind
 * @param {string} [action]
 * @returns {Status}
 */
function status(text, kind, action = StatusAction.NONE) {
  return { text, kind, action };
}

/**
 * @param {'w'|'b'} color
 * @param {{label: string}} connection
 * @returns {string} a readable name for the side that should move.
 */
function sideLabel(color, connection) {
  const name = color === Color.WHITE ? "White" : "Black";
  return connection.label ? `${connection.label} (${name})` : name;
}
