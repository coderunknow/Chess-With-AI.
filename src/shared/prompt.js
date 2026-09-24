/**
 * Prompt construction and AI reply parsing.
 *
 * The prompt is deliberately explicit: it names the side to move, restates the
 * FEN, summarises the game so far, and fixes the exact reply format the
 * extension can parse (`[e2e4]`). Everything here is pure string work.
 *
 * @module shared/prompt
 */

import { MAX_PROMPT_LENGTH, MAX_SCANNED_TEXT_LENGTH } from "./messaging.js";
import { illegalReasonSentence } from "../core/illegal-move.js";

/** Bracketed UCI move, e.g. `[g8f6]` or `[e7e8q]`. */
export const AI_MOVE_PATTERN = /\[([a-h][1-8][a-h][1-8][qrbn]?)\]/gi;

/** Bare UCI move, e.g. `g8f6` (used as a documented fallback). */
const BARE_MOVE_PATTERN = /\b([a-h][1-8][a-h][1-8][qrbn]?)\b/gi;

/** Extra instruction appended when the AI answered with an illegal move. */
export const RETRY_INSTRUCTION =
  "Your previous answer was not a legal move. Reply with exactly one legal move for the side to move, inside square brackets, for example [g8f6].";

/**
 * @param {unknown} value
 * @returns {string} a lower-case UCI move, or `''` when invalid.
 */
export function normaliseUci(value) {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim().toLowerCase();
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text) ? text : "";
}

/**
 * Extracts every bracketed move from `text`, first occurrence first.
 *
 * @param {unknown} text
 * @returns {string[]} unique, normalised UCI moves.
 */
export function extractBracketedMoves(text) {
  return extract(text, AI_MOVE_PATTERN);
}

/**
 * Extracts bracketed moves and, when none are present, bare UCI tokens.
 *
 * @param {unknown} text
 * @returns {string[]} unique, normalised UCI moves, first occurrence first.
 */
export function extractMoveCandidates(text) {
  if (typeof text !== "string" || isPromptShaped(text)) return [];
  const bracketed = extractBracketedMoves(text);
  // A quoted legal-move list is not an AI answer, even if it has a bare UCI.
  return bracketed.length > 0 ? bracketed : extract(text, BARE_MOVE_PATTERN);
}

/**
 * @param {unknown} text
 * @param {RegExp} pattern must be global.
 * @returns {string[]} unique matches, first occurrence first.
 */
function extract(text, pattern) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_SCANNED_TEXT_LENGTH) {
    return [];
  }

  const seen = new Set();
  const matches = [];
  const matcher = new RegExp(pattern.source, pattern.flags);
  let match = matcher.exec(text);
  while (match !== null) {
    const move = normaliseUci(match[1]);
    if (move && !seen.has(move)) {
      seen.add(move);
      matches.push(move);
    }
    match = matcher.exec(text);
  }
  return matches;
}

/**
 * @typedef {object} MovePromptInput
 * @property {string} fen position after the human's move.
 * @property {string} uci the human's move.
 * @property {string} san the human's move in algebraic notation.
 * @property {'w'|'b'} aiColor side the AI plays.
 * @property {string} [history] rendered move list, e.g. `1. e4 e5 2. Nf3`.
 * @property {string} [extraInstruction] appended, e.g. a retry notice.
 */

/**
 * Builds the prompt that asks the AI for its next move.
 *
 * @param {MovePromptInput} input
 * @returns {string} the prompt text.
 */
export function buildMovePrompt({ fen, uci, san, aiColor, history = "", extraInstruction = "" }) {
  const sideName = aiColor === "w" ? "WHITE" : "BLACK";
  const humanName = aiColor === "w" ? "Black" : "White";
  const moveText = san ? `${san} ([${uci}])` : `[${uci}]`;

  const lines = [
    `Chess move request. You are playing ${sideName}. The human plays ${humanName}.`,
    `Position (FEN): ${fen}`,
  ];

  if (history) {
    lines.push(`Moves so far: ${history}`);
  }

  lines.push(
    `The human just played ${moveText}.`,
    `Choose exactly one legal move for ${sideName} in the FEN position above.`,
    "Reply with that move in square brackets using coordinate notation, for example [g8f6] or [e7e8q] for a promotion.",
    "Put the bracketed move first. Do not mention any other move.",
  );

  if (extraInstruction) {
    lines.push(extraInstruction);
  }

  return lines.join("\n");
}

/**
 * Builds the message sent before the first move, so the AI knows the protocol.
 *
 * @param {object} input
 * @param {'w'|'b'} input.aiColor
 * @param {string} input.fen
 * @returns {string} the prompt text.
 */
export function buildOpeningPrompt({ aiColor, fen }) {
  const sideName = aiColor === "w" ? "WHITE" : "BLACK";
  return [
    `Let's play chess. You are ${sideName} and I am ${aiColor === "w" ? "Black" : "White"}.`,
    `Starting position (FEN): ${fen}`,
    "On every turn answer with exactly one legal move in square brackets using coordinate notation, for example [e2e4].",
    "Never answer with more than one bracketed move.",
  ].join("\n");
}

/**
 * Builds the follow-up prompt sent after the AI answered with an illegal move.
 *
 * @param {object} input
 * @param {string} input.fen
 * @param {string} input.uci the illegal move the AI produced.
 * @param {'w'|'b'} input.aiColor
 * @param {string} [input.history]
 * @param {{code:string, facts:Record<string,string>}} [input.reason]
 * @param {string[]} [input.legalMoves] obtained from Position.legalMoves(), never parsed from AI text.
 * @param {string[]} [input.rejectedMoves] moves rejected on this ply.
 * @returns {string} a bounded correction, never a second initial request.
 */
export function buildRetryPrompt({
  fen,
  uci,
  aiColor,
  history = "",
  reason = { code: "not-in-legal-set", facts: {} },
  legalMoves = [],
  rejectedMoves = [uci],
}) {
  const sideName = aiColor === "w" ? "WHITE" : "BLACK";
  // All bracketed examples in a request are echoes, never reply candidates.
  // Never include bare UCI in the legal list: e2-e4 breaks the UCI regex.
  const suffix = [
    `Previously rejected UCIs (do not repeat): ${rejectedMoves.map(hyphenated).join(", ") || "none"}.`,
    `Play a legal move for ${sideName} now.`,
    "Reply with exactly one bracketed coordinate move. Put the bracketed move first. No second bracketed move.",
  ].join("\n");
  const head = [
    `The move [${uci}] is not legal in this position. ${illegalReasonSentence(reason)}`,
    `Position (FEN): ${fen}`,
    `Side to move: ${sideName}.`,
  ];
  // Keep the reason and complete legal-move count even for unusually long
  // histories. Leave room for the list marker, truncation notice and contract.
  const reserved = `\nLegal moves (${legalMoves.length} total): list truncated.\n${suffix}`;
  const remainingHistory = Math.max(0, MAX_PROMPT_LENGTH - head.join("\n").length - reserved.length - 1);
  if (history && remainingHistory > 0)
    head.push(`Moves so far: ${history.slice(0, Math.max(0, remainingHistory - 15))}`);
  const prefix = `${head.join("\n")}\nLegal moves (${legalMoves.length} total): `;
  const tokens = [];
  const safeMoves = legalMoves.map(hyphenated);
  for (const token of safeMoves) {
    const next = [...tokens, token].join(" ");
    const truncated = tokens.length + 1 < safeMoves.length ? " (list truncated)" : "";
    if (`${prefix}${next}${truncated}\n${suffix}`.length > MAX_PROMPT_LENGTH) break;
    tokens.push(token);
  }
  const truncated = tokens.length < safeMoves.length ? " (list truncated)" : "";
  return `${prefix}${tokens.join(" ") || "none"}${truncated}\n${suffix}`;
}

/** @param {string} uci */
function hyphenated(uci) {
  return typeof uci === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)
    ? `${uci.slice(0, 2)}-${uci.slice(2)}`
    : String(uci)
        .slice(0, 20)
        .replace(/[^a-z0-9-]/gi, "?");
}

/**
 * Formats a move list as `1. e4 e5 2. Nf3 Nc6`.
 *
 * @param {Array<{san: string}>} moves
 * @param {object} [options]
 * @param {number} [options.startMoveNumber] defaults to 1.
 * @param {boolean} [options.blackToMoveFirst] true when the list starts with Black's move.
 * @param {number} [options.maxPlies] truncate the list to the most recent plies.
 * @returns {string} rendered move list, or `''` when there are no moves.
 */
export function formatMoveList(moves, { startMoveNumber = 1, blackToMoveFirst = false, maxPlies = 20 } = {}) {
  if (!Array.isArray(moves) || moves.length === 0) {
    return "";
  }

  const recent = moves.slice(-maxPlies);
  const tokens = [];
  const offset = moves.length - recent.length;
  let moveNumber = startMoveNumber + Math.floor(offset / 2);
  let whiteToMove = blackToMoveFirst ? false : offset % 2 === 0;

  if (!whiteToMove) {
    tokens.push(`${moveNumber}...`);
  }

  for (const move of recent) {
    if (whiteToMove) {
      tokens.push(`${moveNumber}.`);
    }
    tokens.push(move.san || move.uci || "?");
    if (!whiteToMove) {
      moveNumber += 1;
    }
    whiteToMove = !whiteToMove;
  }

  return tokens.join(" ");
}

/**
 * Detects text that is really the extension's own prompt echoed back in the
 * page (chat UIs render the user's message, which the observer would otherwise
 * mistake for an AI reply).
 *
 * @param {string} text candidate reply text.
 * @param {string} prompt the prompt that was typed.
 * @returns {boolean} true when `text` is (part of) `prompt`.
 */
export function isEchoOfPrompt(text, prompt) {
  if (!text) return false;
  if (isPromptShaped(text)) return true;
  if (!prompt) return false;
  const normalise = (value) => value.replace(/\s+/g, " ").trim();
  const haystack = normalise(text);
  const needle = normalise(prompt);
  return haystack === needle || (needle.length > 40 && haystack.startsWith(needle.slice(0, 40)));
}

/** A quote of a prompt or a legal-move list is not a reply. */
function isPromptShaped(text) {
  return (
    /Chess move request\.|Position \(FEN\):|Starting position \(FEN\):|The move \[[a-h][1-8][a-h][1-8]/i.test(text) ||
    /Legal moves\s*\(/i.test(text) ||
    /Previously rejected UCIs/i.test(text) ||
    /Let's play chess\. You are/i.test(text)
  );
}
