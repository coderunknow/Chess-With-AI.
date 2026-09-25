/**
 * Prompt construction and AI reply parsing — the single source of truth for
 * every platform and every style.
 *
 * The prompt is deliberately explicit: it names the side to move, restates the
 * FEN, summarises the game so far, and fixes the exact reply format the
 * extension can parse (`[e2e4]`). Styles (standard/concise/efficient/fun) vary
 * only the output contract — the game state and decision context are identical.
 * Everything here is pure string work.
 *
 * @module shared/prompt
 */

import { MAX_PROMPT_LENGTH, MAX_SCANNED_TEXT_LENGTH } from "./messaging.js";
import { illegalReasonSentence } from "../core/illegal-move.js";
import { formatClock } from "./clock.js";
import { FUN_SENTENCES_MAX, FUN_SENTENCES_MIN, PROMPT_STYLES } from "./settings.js";

/** Size budget for a prompt; the Prompt Studio warns above it. */
export const PROMPT_SIZE_BUDGET = 800;

/** Default fun-mode commentary length (sentences). */
export const DEFAULT_FUN_SENTENCES = 2;

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
 * @param {object} [options]
 * @param {boolean} [options.allowBare] false disables the bare-UCI fallback (streaming text).
 * @returns {string[]} unique, normalised UCI moves, first occurrence first.
 */
export function extractMoveCandidates(text, { allowBare = true } = {}) {
  if (typeof text !== "string" || isPromptShaped(text)) return [];
  const bracketed = extractBracketedMoves(text);
  // A quoted legal-move list is not an AI answer, even if it has a bare UCI.
  // `allowBare: false` is used while a reply is still streaming: a token such
  // as `[e7e8` (before `q]` arrives) must never be read as the bare `e7e8`.
  if (bracketed.length > 0 || !allowBare) return bracketed;
  return extract(text, BARE_MOVE_PATTERN);
}

/**
 * Removes a VERBATIM copy of one of our own prompts from a reply container's
 * text (hosts that wrap the user turn and the answer together, or an AI that
 * quotes the whole request before answering). Only an exact, complete,
 * whitespace-normalised copy is removed — partial quotes are left alone and
 * stay prompt-shaped, so they can never become a move.
 *
 * @param {string} text normalised reply text.
 * @param {ReadonlyArray<string>} prompts prompts we sent (newest last).
 * @returns {{text: string, stripped: boolean}} the remainder.
 */
export function stripPromptEcho(text, prompts) {
  if (typeof text !== "string" || !Array.isArray(prompts)) return { text: String(text ?? ""), stripped: false };
  const collapse = (value) => String(value).replace(/\s+/g, " ").trim();
  let haystack = collapse(text);
  let stripped = false;
  for (const prompt of [...prompts].reverse()) {
    const needle = collapse(prompt);
    if (needle.length < 20) continue;
    const at = haystack.indexOf(needle);
    if (at === -1) continue;
    haystack = collapse(`${haystack.slice(0, at)} ${haystack.slice(at + needle.length)}`);
    stripped = true;
  }
  return { text: stripped ? haystack : text, stripped };
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
 * @typedef {object} BattleClockCue
 * @property {number} remainingMs the side-to-move's remaining clock time.
 * @property {number} incrementSec the side-to-move's increment.
 */

/**
 * @typedef {object} MovePromptInput
 * @property {string} fen position after the human's move.
 * @property {string} uci the human's move.
 * @property {string} san the human's move in algebraic notation.
 * @property {'w'|'b'} aiColor side the AI plays.
 * @property {string} [history] rendered move list, e.g. `1. e4 e5 2. Nf3`.
 * @property {string} [extraInstruction] appended, e.g. a retry notice.
 * @property {'standard'|'concise'|'efficient'|'fun'} [style] response/output style only.
 * @property {number} [funSentences] fun-mode commentary length (1–2).
 * @property {BattleClockCue|null} [battleClock] clock context, kept in every style.
 */

/**
 * The chess-clock cue — decision-relevant context that concision must never
 * strip. Part of the battle prompt variant and of every styled prompt.
 *
 * @param {BattleClockCue|null|undefined} battleClock
 * @returns {string} the clock line, or `''` outside battles.
 */
export function battleClockLine(battleClock) {
  if (!battleClock || typeof battleClock !== "object") return "";
  const remainingMs = Number(battleClock.remainingMs);
  const incrementSec = Number(battleClock.incrementSec);
  if (!Number.isFinite(remainingMs) || !Number.isFinite(incrementSec)) return "";
  return `You have ${formatClock(Math.max(0, remainingMs))} left; your increment is ${Math.max(0, Math.round(incrementSec))}s.`;
}

/**
 * Fun-mode tail: the move comes first; the commentary must not smuggle moves.
 *
 * @param {number} [funSentences]
 * @returns {string[]} lines.
 */
function funTail(funSentences) {
  const n = Math.max(
    FUN_SENTENCES_MIN,
    Math.min(FUN_SENTENCES_MAX, Math.round(Number(funSentences) || DEFAULT_FUN_SENTENCES)),
  );
  return [
    `After the move, add ${n} short witty sentence${n === 1 ? "" : "s"} of commentary about the move or position.`,
    "Keep the commentary fun and do not use square brackets in it.",
  ];
}

/**
 * Appends the style/context tail shared by every prompt variant.
 *
 * @param {string[]} lines mutated in place.
 * @param {object} input
 * @param {string} [input.style]
 * @param {number} [input.funSentences]
 * @param {BattleClockCue|null} [input.battleClock]
 * @param {string} [input.extraInstruction]
 */
function appendContextTail(lines, { style, funSentences, battleClock, extraInstruction = "" } = {}) {
  const clock = battleClockLine(battleClock);
  if (clock) lines.push(clock);
  if (style === PROMPT_STYLES.FUN) lines.push(...funTail(funSentences));
  if (extraInstruction) lines.push(extraInstruction);
}

/**
 * Builds the prompt that asks the AI for its next move.
 *
 * @param {MovePromptInput} input
 * @returns {string} the prompt text.
 */
export function buildMovePrompt({
  fen,
  uci,
  san,
  aiColor,
  history = "",
  extraInstruction = "",
  style = PROMPT_STYLES.STANDARD,
  funSentences = DEFAULT_FUN_SENTENCES,
  battleClock = null,
  opponentIsAi = false,
}) {
  const sideName = aiColor === "w" ? "WHITE" : "BLACK";
  const humanName = aiColor === "w" ? "Black" : "White";
  const moveText = san ? `${san} ([${uci}])` : `[${uci}]`;

  const lines = [
    `Chess move request. You are playing ${sideName}. ${
      opponentIsAi ? `Your opponent is another AI playing ${humanName}.` : `The human plays ${humanName}.`
    }`,
    `Position (FEN): ${fen}`,
  ];

  if (history) {
    lines.push(`Moves so far: ${history}`);
  }

  lines.push(
    `The ${opponentIsAi ? "other AI" : "human"} just played ${moveText}.`,
    `Choose exactly one legal move for ${sideName} in the FEN position above.`,
  );
  lines.push("Check that the move is legal here — pins, castling, en passant and promotion rules apply.");
  if (style === PROMPT_STYLES.EFFICIENT) {
    // Minimal output: the chosen move only, in the existing UCI-in-brackets format.
    lines.push(
      "Reply with only that move in coordinate notation inside square brackets, for example [g8f6]. No commentary or extra text.",
    );
  } else if (style === PROMPT_STYLES.CONCISE) {
    lines.push("Reply with one bracketed coordinate move, for example [g8f6]. Put it first; no other move.");
  } else {
    lines.push(
      "Reply with that move in square brackets using coordinate notation, for example [g8f6] or [e7e8q] for a promotion.",
      "Put the bracketed move first. Do not mention any other move.",
    );
  }
  appendContextTail(lines, { style, funSentences, battleClock, extraInstruction });

  return lines.join("\n");
}

/**
 * Builds the message sent before the first move, so the AI knows the protocol.
 *
 * @param {object} input
 * @param {'w'|'b'} input.aiColor
 * @param {string} input.fen
 * @param {string} [input.style]
 * @param {number} [input.funSentences]
 * @param {BattleClockCue|null} [input.battleClock]
 * @param {string} [input.extraInstruction]
 * @returns {string} the prompt text.
 */
export function buildOpeningPrompt({
  aiColor,
  fen,
  style = PROMPT_STYLES.STANDARD,
  funSentences = DEFAULT_FUN_SENTENCES,
  battleClock = null,
  extraInstruction = "",
  opponentIsAi = false,
}) {
  const sideName = aiColor === "w" ? "WHITE" : "BLACK";
  const opponentName = aiColor === "w" ? "Black" : "White";
  const lines = [
    opponentIsAi
      ? `Let's play chess. You are ${sideName}; your opponent is another AI playing ${opponentName}.`
      : `Let's play chess. You are ${sideName} and I am ${opponentName}.`,
    `Starting position (FEN): ${fen}`,
    "On every turn answer with exactly one legal move in square brackets using coordinate notation, for example [e2e4].",
    "Never answer with more than one bracketed move.",
    "Check that every move is legal in the position before answering.",
  ];
  if (style === PROMPT_STYLES.EFFICIENT) {
    lines.push("Reply with only the bracketed move each turn. No commentary or extra text.");
  }
  appendContextTail(lines, { style, funSentences, battleClock, extraInstruction });
  return lines.join("\n");
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
 * @param {string} [input.style]
 * @param {number} [input.funSentences]
 * @param {BattleClockCue|null} [input.battleClock]
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
  style = PROMPT_STYLES.STANDARD,
  funSentences = DEFAULT_FUN_SENTENCES,
  battleClock = null,
}) {
  const sideName = aiColor === "w" ? "WHITE" : "BLACK";
  // All bracketed examples in a request are echoes, never reply candidates.
  // Never include bare UCI in the legal list: e2-e4 breaks the UCI regex.
  const suffixLines = [
    `Previously rejected UCIs (do not repeat): ${rejectedMoves.map(hyphenated).join(", ") || "none"}.`,
    `Play a legal move for ${sideName} now.`,
    "Reply with exactly one bracketed coordinate move. Put the bracketed move first. No second bracketed move.",
  ];
  if (style === PROMPT_STYLES.EFFICIENT) {
    suffixLines.push("Reply with only the bracketed move. No commentary or extra text.");
  }
  appendContextTail(suffixLines, { style, funSentences, battleClock });
  const suffix = suffixLines.join("\n");
  const head = [
    uci
      ? `The move [${uci}] is not legal in this position. ${illegalReasonSentence(reason)}`
      : `No usable move arrived. ${illegalReasonSentence(reason)}`,
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
 * Builds the exact prompt the send path dispatches for the current turn —
 * shared verbatim by App and the Prompt Studio so studio output and the sent
 * prompt can never diverge.
 *
 * @param {object} context
 * @param {string} context.fen
 * @param {'w'|'b'} context.aiColor
 * @param {string} [context.uci] last move; empty on an opening prompt.
 * @param {string} [context.san]
 * @param {string} [context.history]
 * @param {number} [context.plyCount] 0 starts the game (opening prompt).
 * @param {string} [context.style]
 * @param {number} [context.funSentences]
 * @param {BattleClockCue|null} [context.battleClock]
 * @param {string} [context.extraInstruction]
 * @returns {string} the prompt text.
 */
export function buildTurnPrompt(context) {
  const { plyCount = 0, ...input } = context || {};
  if ((plyCount ?? 0) === 0 && !input.uci) {
    return buildOpeningPrompt(input);
  }
  return buildMovePrompt(input);
}

/**
 * Prompt size metrics for the studio: chars/lines plus a warning above the
 * ~800-character budget.
 *
 * @param {string} text
 * @returns {{chars: number, lines: number, overBudget: boolean}}
 */
export function describePromptMetrics(text) {
  const value = typeof text === "string" ? text : "";
  return {
    chars: value.length,
    lines: value.split("\n").length,
    overBudget: value.length > PROMPT_SIZE_BUDGET,
  };
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
