/**
 * Status line model — v2 with i18n, degraded mode, and clearer next actions.
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
  RELOAD_TAB: "reload-tab",
  COPY_PROMPT: "copy-prompt",
  UNDO_DELETE: "undo-delete",
});

/**
 * @typedef {object} StatusInput
 * @property {import('./game.js').GameSession} session
 * @property {{supported: boolean, platform: string, label: string, tabId:number|null}} connection
 * @property {'idle'|'sending'|'awaiting'|'error'} phase
 * @property {string} [message] free-form override, e.g. a specific error.
 * @property {boolean} [busy] true while a prompt is being injected.
 * @property {(key:string, params?:Record<string,unknown>)=>string} [t] translator
 * @property {string} [diagnosticsError] last diagnostics error
 */

/**
 * @typedef {object} Status
 * @property {string} text
 * @property {'info'|'success'|'waiting'|'error'} kind
 * @property {''|'ask-ai'|'open-ai'|'retry'|'new-game'|'reload-tab'|'copy-prompt'|'undo-delete'} action
 */

/**
 * @param {StatusInput} input
 * @returns {Status}
 */
export function describeStatus({
  session,
  connection,
  phase,
  message = "",
  busy = false,
  t = null,
  diagnosticsError = "",
}) {
  const tr =
    t ||
    ((key, params) => {
      // Fallback English without interpolation
      if (params) {
        let text = key;
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v));
        }
        return text;
      }
      return key;
    });

  // Helper to create status with translation fallback
  const make = (text, kind, action = StatusAction.NONE) => status(text, kind, action);

  // If message is already a user-facing string (from t), use it directly
  // Detect actionable errors
  if (phase === "error" && message) {
    const lower = message.toLowerCase();
    if (lower.includes("content script") || lower.includes("not found") || lower.includes("reload")) {
      return make(message, StatusKind.ERROR, StatusAction.RELOAD_TAB);
    }
    if (lower.includes("copy") || lower.includes("clipboard") || lower.includes("composer")) {
      return make(message, StatusKind.ERROR, StatusAction.COPY_PROMPT);
    }
    if (lower.includes("storage") && lower.includes("full")) {
      return make(message, StatusKind.ERROR, StatusAction.NONE);
    }
    return make(message, StatusKind.ERROR, actionFor(session, connection, diagnosticsError));
  }

  if (busy || phase === "sending") {
    const platform = connection.label || "the AI";
    const text = tr ? tr("status.sending", { platform }) : `Sending your move to ${platform}…`;
    return make(text, StatusKind.WAITING);
  }

  if (session.isGameOver) {
    return make(describeOutcome(session, tr), StatusKind.INFO, StatusAction.NEW_GAME);
  }

  if (!connection.supported) {
    if (phase === "awaiting" || session.isWaitingForAi) {
      const opponent = sideLabel(session.aiColor, connection, tr);
      const text = message
        ? message
        : tr
          ? tr("status.waitingAi", { platform: opponent }) + " No AI chat open."
          : `It is ${opponent}'s turn, but no AI chat is open. Open a supported AI to keep playing.`;
      return make(text, StatusKind.WAITING, StatusAction.OPEN_AI);
    }
    const text = message
      ? message
      : tr
        ? tr("status.noAi")
        : "No AI chat detected. Open one of the supported AI chats to play.";
    const lower = text.toLowerCase();
    const action = lower.includes("no ai") ? StatusAction.OPEN_AI : StatusAction.NONE;
    return make(text, StatusKind.INFO, action);
  }

  if (message) {
    return make(message, StatusKind.INFO, actionFor(session, connection, diagnosticsError));
  }

  if (phase === "awaiting" || session.isWaitingForAi) {
    const text = tr
      ? tr("status.waitingAi", { platform: connection.label })
      : `Waiting for ${connection.label} to answer…`;
    return make(text, StatusKind.WAITING, StatusAction.ASK_AI);
  }

  if (session.isCheck) {
    const text = tr ? tr("status.check") : "You are in check — only legal escapes are shown.";
    return make(text, StatusKind.ERROR);
  }

  const colorName = session.playerColor === Color.WHITE ? "White" : "Black";
  const text = tr ? tr("status.yourMove", { color: colorName }) : `Your move. Playing as ${colorName}.`;
  return make(text, StatusKind.SUCCESS);
}

/**
 * @param {import('./game.js').GameSession} session
 * @param {(key:string, params?:any)=>string} [t]
 * @returns {string} a description of the finished game.
 */
export function describeOutcome(session, t = null) {
  const outcome = session.outcome;
  const mover = session.playerColor === Color.WHITE ? "White" : "Black";

  if (t) {
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
 * @param {import('./game.js').GameSession} session
 * @param {{supported:boolean}} connection
 * @param {string} [diagnosticsError]
 * @returns {string} the primary action offered.
 */
export function actionFor(session, connection, diagnosticsError = "") {
  if (diagnosticsError) {
    const lower = diagnosticsError.toLowerCase();
    if (lower.includes("input") || lower.includes("composer")) {
      return StatusAction.COPY_PROMPT;
    }
    if (lower.includes("content script") || lower.includes("reload")) {
      return StatusAction.RELOAD_TAB;
    }
  }
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
 * @param {(key:string, params?:any)=>string} [t]
 * @returns {string} a readable name for the side that should move.
 */
function sideLabel(color, connection, t = null) {
  const name = color === Color.WHITE ? "White" : "Black";
  if (t && connection.label) {
    return `${connection.label} (${name})`;
  }
  return connection.label ? `${connection.label} (${name})` : name;
}
