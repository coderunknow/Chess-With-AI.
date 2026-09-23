/**
 * Standard Algebraic Notation and PGN import/export.
 *
 * @module core/pgn
 */

import { isCapture, isCastle } from "./move.js";
import { Position } from "./position.js";
import { FILES, RANKS, fileOf, rankOf, toName } from "./squares.js";

/** PGN result tokens. */
export const PGN_RESULT = Object.freeze({
  WHITE_WIN: "1-0",
  BLACK_WIN: "0-1",
  DRAW: "1/2-1/2",
  UNKNOWN: "*",
});

const RESULTS = Object.freeze(Object.values(PGN_RESULT));
const HEADER_PATTERN = /^\[(\w+)\s+"([^"]*)"\]$/;
const RESULT_PATTERN = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const COMMENT_PATTERN = /\{[^}]*\}/g;
const VARIATION_PATTERN = /\([^()]*\)/g;
const NAG_PATTERN = /\$\d+/g;
const ANNOTATION_PATTERN = /[!?]+$/;
const STANDARD_START_PREFIX = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq";

/**
 * Renders a legal move in Standard Algebraic Notation, including the `+` or `#`
 * suffix and the disambiguation letter/number required by the PGN standard.
 *
 * @param {Position} position position *before* `move`.
 * @param {import('./move.js').Move} move a legal move in `position`.
 * @returns {string} SAN text, e.g. `Nbd7`, `exd5`, `O-O`, `e8=Q+`.
 */
export function toSan(position, move) {
  const piece = position.pieceAt(move.from);

  if (isCastle(move)) {
    return finaliseSan(position, move, move.to > move.from ? "O-O" : "O-O-O");
  }

  if (piece.toLowerCase() === "p") {
    const prefix = isCapture(move) ? `${FILES[fileOf(move.from)]}x` : "";
    const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : "";
    return finaliseSan(position, move, `${prefix}${toName(move.to)}${promotion}`);
  }

  let san = piece.toUpperCase();
  const rivals = position.legalMoves().filter((candidate) => {
    if (candidate.from === move.from || candidate.to !== move.to) {
      return false;
    }
    return position.pieceAt(candidate.from).toLowerCase() === piece.toLowerCase();
  });

  if (rivals.length > 0) {
    const sameFile = rivals.some((rival) => fileOf(rival.from) === fileOf(move.from));
    const sameRank = rivals.some((rival) => rankOf(rival.from) === rankOf(move.from));
    if (!sameFile) {
      san += FILES[fileOf(move.from)];
    } else if (!sameRank) {
      san += RANKS[rankOf(move.from)];
    } else {
      san += toName(move.from);
    }
  }

  san += isCapture(move) ? "x" : "";
  san += toName(move.to);
  return finaliseSan(position, move, san);
}

/**
 * @param {Position} position position before the move.
 * @param {import('./move.js').Move} move
 * @param {string} san SAN text without a check/mate suffix.
 * @returns {string} `san` with the correct suffix appended.
 */
function finaliseSan(position, move, san) {
  const after = position.clone();
  after.makeMove(move, { validate: false });
  if (after.isCheckmate()) {
    return `${san}#`;
  }
  return after.isCheck() ? `${san}+` : san;
}

/**
 * Normalises SAN text so that sloppy annotations still match: `0-0` -> `O-O`,
 * `e8Q` -> `e8=Q`, annotations and check markers removed.
 *
 * @param {string} token
 * @returns {string} normalised token.
 */
export function normaliseSanToken(token) {
  return String(token)
    .trim()
    .replace(ANNOTATION_PATTERN, "")
    .replace(/[+#]/g, "")
    .replace(/0-0-0/gi, "O-O-O")
    .replace(/0-0/gi, "O-O")
    .replace(/=[qrbn](?![a-z])/gi, (match) => `=${match.slice(1).toUpperCase()}`)
    .replace(/(?<!=)[qrbn]$/i, (match) => `=${match.toUpperCase()}`);
}

/**
 * Resolves a SAN token into a legal move in `position`.
 *
 * @param {Position} position
 * @param {string} token
 * @returns {import('./move.js').Move|null} the matching legal move.
 */
export function moveFromSan(position, token) {
  const wanted = normaliseSanToken(token);
  if (!wanted) {
    return null;
  }
  for (const move of position.legalMoves()) {
    if (normaliseSanToken(toSan(position, move)) === wanted) {
      return move;
    }
  }
  return null;
}

/**
 * @typedef {object} PgnGame
 * @property {string} initialFen FEN the game started from.
 * @property {string[]} san Moves in Standard Algebraic Notation.
 * @property {string} result PGN result token.
 * @property {Record<string, string>} headers PGN tag pairs.
 */

/**
 * Renders a PGN document.
 *
 * @param {object} input
 * @param {string} input.initialFen starting FEN.
 * @param {string[]} input.san moves in SAN.
 * @param {string} [input.result] PGN result token.
 * @param {Record<string, string>} [input.headers] extra PGN tag pairs.
 * @param {number} [input.lineWidth] movetext wrap column, 0 disables wrapping.
 * @returns {string} PGN text.
 */
export function formatPgn({ initialFen, san, result = PGN_RESULT.UNKNOWN, headers = {}, lineWidth = 80 }) {
  const tags = {
    Event: "Casual game",
    Site: "AI Chess Companion",
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, "."),
    Round: "-",
    White: "Human",
    Black: "AI",
    ...headers,
    Result: RESULTS.includes(result) ? result : PGN_RESULT.UNKNOWN,
  };

  if (!initialFen.startsWith(STANDARD_START_PREFIX)) {
    tags.FEN = initialFen;
    tags.SetUp = "1";
  }

  const orderedKeys = [
    "Event",
    "Site",
    "Date",
    "Round",
    "White",
    "Black",
    "Result",
    "FEN",
    "SetUp",
    ...Object.keys(tags).filter(
      (key) => !["Event", "Site", "Date", "Round", "White", "Black", "Result", "FEN", "SetUp"].includes(key),
    ),
  ];

  const headerLines = orderedKeys
    .filter((key) => tags[key] !== undefined && tags[key] !== "")
    .map((key) => `[${key} "${String(tags[key]).replace(/"/g, "'")}"]`);

  return `${[...headerLines, "", ...wrapTokens(buildMovetextTokens(initialFen, san, tags.Result), lineWidth)]
    .join("\n")
    .trimEnd()}\n`;
}

/**
 * @param {string} initialFen
 * @param {string[]} san
 * @param {string} result
 * @returns {string[]} movetext tokens.
 */
function buildMovetextTokens(initialFen, san, result) {
  const fields = initialFen.split(/\s+/);
  let moveNumber = Number.parseInt(fields[5] || "1", 10) || 1;
  let whiteToMove = (fields[1] || "w") === "w";
  const tokens = [];

  if (!whiteToMove && san.length > 0) {
    tokens.push(`${moveNumber}...`);
  }

  for (const move of san) {
    if (whiteToMove) {
      tokens.push(`${moveNumber}.`);
    }
    tokens.push(move);
    if (!whiteToMove) {
      moveNumber += 1;
    }
    whiteToMove = !whiteToMove;
  }

  tokens.push(result);
  return tokens;
}

/**
 * @param {string[]} tokens
 * @param {number} lineWidth
 * @returns {string[]} wrapped movetext lines.
 */
function wrapTokens(tokens, lineWidth) {
  if (!lineWidth || lineWidth <= 0) {
    return [tokens.join(" ")];
  }
  const lines = [];
  let line = "";
  for (const token of tokens) {
    const candidate = line ? `${line} ${token}` : token;
    if (candidate.length > lineWidth && line) {
      lines.push(line);
      line = token;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

/**
 * Parses a PGN document. Comments, variations, NAGs and annotations are
 * ignored. Without `strict`, parsing stops at the first unreadable move and the
 * successful prefix is returned together with an `error` description.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.strict] raise on the first unreadable move.
 * @returns {{game: PgnGame, moves: import('./move.js').Move[], position: Position|null, error: string}}
 */
export function parsePgn(text, { strict = false } = {}) {
  if (typeof text !== "string" || text.trim() === "") {
    return failure("PGN text is empty.");
  }

  const headers = {};
  const tokens = [];
  let result = PGN_RESULT.UNKNOWN;

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const headerMatch = HEADER_PATTERN.exec(line);
    if (headerMatch) {
      headers[headerMatch[1]] = headerMatch[2];
      continue;
    }

    const cleaned = line.replace(COMMENT_PATTERN, " ").replace(VARIATION_PATTERN, " ").replace(NAG_PATTERN, " ");
    for (const rawToken of cleaned.split(/\s+/)) {
      if (!rawToken) {
        continue;
      }
      if (RESULT_PATTERN.test(rawToken)) {
        result = rawToken;
        continue;
      }
      if (/^\d+\.*$/.test(rawToken)) {
        continue;
      }
      tokens.push(rawToken.replace(/^\d+\.+/, ""));
    }
  }

  const startFen = headers.FEN || Position.start().toFen();
  let position;
  try {
    position = Position.fromFen(startFen);
  } catch (error) {
    return failure(`Invalid PGN start position: ${error.message}`);
  }

  const moves = [];
  const san = [];
  for (const token of tokens) {
    const move = moveFromSan(position, token);
    if (!move) {
      const message = `Illegal or unreadable move "${token}" at ply ${moves.length + 1}.`;
      if (strict) {
        return failure(message);
      }
      return {
        game: { initialFen: startFen, san, result, headers },
        moves,
        position,
        error: message,
      };
    }
    san.push(toSan(position, move));
    position.makeMove(move, { validate: false });
    moves.push(move);
  }

  return {
    game: { initialFen: startFen, san, result, headers },
    moves,
    position,
    error: "",
  };
}

/**
 * @param {string} message
 * @returns {{game: PgnGame, moves: [], position: null, error: string}}
 */
function failure(message) {
  return {
    game: { initialFen: "", san: [], result: PGN_RESULT.UNKNOWN, headers: {} },
    moves: [],
    position: null,
    error: message,
  };
}

/**
 * @param {string} text
 * @returns {string[]} UCI moves parsed from a PGN document.
 */
export function pgnToUciMoves(text) {
  return parsePgn(text).moves.map((move) => `${toName(move.from)}${toName(move.to)}${move.promotion}`);
}
