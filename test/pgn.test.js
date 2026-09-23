import assert from "node:assert/strict";
import test from "node:test";

import { Position } from "../src/core/position.js";
import { parsePgn, pgnToUciMoves, formatPgn, moveFromSan, normaliseSanToken, toSan } from "../src/core/pgn.js";

const OPERA_GAME_SAN = [
  "e4",
  "e5",
  "Nf3",
  "d6",
  "d4",
  "Bg4",
  "dxe5",
  "Bxf3",
  "Qxf3",
  "dxe5",
  "Bc4",
  "Nf6",
  "Qb3",
  "Qe7",
  "Nc3",
  "c6",
  "Bg5",
  "b5",
  "Nxb5",
  "cxb5",
  "Bxb5+",
  "Nbd7",
  "O-O-O",
  "Rd8",
  "Rxd7",
  "Rxd7",
  "Rd1",
  "Qe6",
  "Bxd7+",
  "Nxd7",
  "Qb8+",
  "Nxb8",
  "Rd8#",
];

const OPERA_GAME_PGN = `[Event "Paris Opera House"]
[Site "Paris FRA"]
[Date "1858.10.21"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0
`;

/**
 * Replays SAN moves and returns the SAN list produced by the engine.
 *
 * @param {string[]} san
 * @returns {{replayed: string[], position: Position, error: string}}
 */
function replay(san) {
  const position = Position.start();
  const replayed = [];
  for (const token of san) {
    const move = moveFromSan(position, token);
    if (!move) {
      return { replayed, position, error: `could not resolve ${token}` };
    }
    replayed.push(toSan(position, move));
    position.makeMove(move, { validate: false });
  }
  return { replayed, position, error: "" };
}

test("SAN includes capture, check and mate markers", () => {
  const { replayed, position, error } = replay(OPERA_GAME_SAN);
  assert.equal(error, "");
  assert.equal(replayed.join(" "), OPERA_GAME_SAN.join(" "));
  assert.ok(position.isCheckmate(), "Rd8# ends the game");
});

test("SAN disambiguates pieces by file, rank or full square", () => {
  // Knights on b1 and f3 can both reach d2: file letter resolves it.
  const fileClash = Position.fromFen("4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1", { strict: false });
  const knightMove = fileClash.moveFromUci("b1d2");
  assert.equal(toSan(fileClash, knightMove), "Nbd2");

  // Rooks on a1 and a3 share a file: the rank number resolves it.
  const rankClash = Position.fromFen("4k3/8/8/8/8/R7/8/R3K3 w - - 0 1", { strict: false });
  assert.equal(toSan(rankClash, rankClash.moveFromUci("a1a2")), "R1a2");

  // Queens on a3 (same file) and c1 (same rank) also reach b2: the full square is required.
  const squareClash = Position.fromFen("4k3/8/8/8/8/Q7/8/Q1Q3K1 w - - 0 1");
  assert.equal(toSan(squareClash, squareClash.moveFromUci("a1b2")), "Qa1b2");

  // A quiet pawn push carries no prefix.
  const pawnPush = Position.start();
  assert.equal(toSan(pawnPush, pawnPush.moveFromUci("e2e4")), "e4");
});

test("SAN renders castling, promotion and en passant", () => {
  const castling = Position.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  assert.equal(toSan(castling, castling.moveFromUci("e1g1")), "O-O");
  assert.equal(toSan(castling, castling.moveFromUci("e1c1")), "O-O-O");

  const promotion = Position.fromFen("7k/4P3/8/8/8/8/8/4K3 w - - 0 1", { strict: false });
  assert.match(toSan(promotion, promotion.moveFromUci("e7e8q")), /^e8=Q/);
  assert.match(toSan(promotion, promotion.moveFromUci("e7e8n")), /^e8=N/);

  const enPassant = Position.fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2", { strict: false });
  assert.equal(toSan(enPassant, enPassant.moveFromUci("e5d6")), "exd6");
});

test("SAN tokens are normalised tolerantly", () => {
  assert.equal(normaliseSanToken("0-0"), "O-O");
  assert.equal(normaliseSanToken("e8Q"), "e8=Q");
  assert.equal(normaliseSanToken("Qxe5+?!"), "Qxe5");
  assert.equal(normaliseSanToken("exd5"), "exd5");
});

test("the engine parses a full annotated PGN document", () => {
  const result = parsePgn(OPERA_GAME_PGN);
  assert.equal(result.error, "");
  assert.equal(result.game.san.length, 33);
  assert.deepEqual(result.game.san, OPERA_GAME_SAN);
  assert.equal(result.game.result, "1-0");
  assert.equal(result.game.headers.White, "Paul Morphy");
  assert.ok(result.position.isCheckmate());
});

test("PGN parsing ignores comments, variations, NAGs and annotations", () => {
  const text = `[Result "1/2-1/2"]

1. e4 {king pawn} e5 $1 2. Nf3 (2. Bc4 Nf6) Nc6 3. Bb5!? a6 1/2-1/2`;
  const result = parsePgn(text);
  assert.equal(result.error, "");
  assert.deepEqual(result.game.san, ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
  assert.equal(result.game.result, "1/2-1/2");
});

test("PGN parsing tolerates sloppy notation", () => {
  const sloppy = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 Nf6 5. d3 0-0 6. Nc3 d6";
  const result = parsePgn(sloppy);
  assert.equal(result.error, "");
  assert.deepEqual(result.game.san, ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6", "d3", "O-O", "Nc3", "d6"]);
});

test("PGN parsing reports the illegal move and keeps the valid prefix", () => {
  const result = parsePgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. Nc3 Kd4 *");
  assert.match(result.error, /Kd4/);
  assert.deepEqual(result.game.san, ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6", "Nc3"]);

  const strict = parsePgn("1. e4 e5 2. Nf3 Nc3 *", { strict: true });
  assert.match(strict.error, /Nc3/);
  assert.deepEqual(strict.game.san, []);
});

test("PGN parsing rejects empty input and bad start positions", () => {
  assert.match(parsePgn("").error, /empty/);
  assert.match(parsePgn("   ").error, /empty/);
  assert.match(parsePgn('[FEN "nonsense"]\n\n1. e4 *').error, /Invalid PGN start position/);
});

test("PGN export writes standard headers and movetext", () => {
  const pgn = formatPgn({
    initialFen: Position.start().toFen(),
    san: OPERA_GAME_SAN,
    result: "1-0",
    headers: { White: "Paul Morphy", Black: "Duke Karl" },
  });

  assert.match(pgn, /^\[Event "Casual game"\]$/m);
  assert.match(pgn, /^\[White "Paul Morphy"\]$/m);
  assert.match(pgn, /^\[Result "1-0"\]$/m);
  assert.ok(!pgn.includes("[FEN"), "standard start positions need no SetUp header");
  assert.match(pgn, /1\. e4 e5 2\. Nf3 d6/);
  assert.ok(pgn.endsWith("1-0\n"));

  for (const line of pgn.split("\n")) {
    if (line.startsWith("[")) {
      continue;
    }
    assert.ok(line.length <= 80, `line too long: ${line}`);
  }
});

test("PGN export records a custom start position", () => {
  const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2";
  const pgn = formatPgn({ initialFen: fen, san: ["exd6"], result: "*" });
  assert.match(pgn, /^\[FEN "4k3\/8\/8\/3pP3\/8\/8\/8\/4K3 w - d6 0 2"\]$/m);
  assert.match(pgn, /^\[SetUp "1"\]$/m);
  assert.match(pgn, /\n\n2\. exd6 \*\n$/, "move numbering continues from the FEN");
});

test("PGN export then import reproduces the same game", () => {
  const pgn = formatPgn({
    initialFen: Position.start().toFen(),
    san: OPERA_GAME_SAN,
    result: "1-0",
  });
  const parsed = parsePgn(pgn);
  assert.equal(parsed.error, "");
  assert.deepEqual(parsed.game.san, OPERA_GAME_SAN);

  const replayed = replay(parsed.game.san);
  assert.equal(replayed.error, "");
  assert.ok(replayed.position.isCheckmate());
});

test("pgnToUciMoves returns playable UCI moves", () => {
  const uci = pgnToUciMoves(OPERA_GAME_PGN);
  assert.equal(uci.length, 33);
  assert.equal(uci[0], "e2e4");
  assert.equal(uci[8], "d1f3", "Qxf3 recaptures");
  assert.equal(uci[10], "f1c4", "Bc4");
  assert.equal(uci[22], "e1c1", "white castles queen side");
  assert.equal(uci[32], "d1d8", "the final rook mate");
});

test("PGN parsing accepts a game that starts from the black side", () => {
  const text = '[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"]\n\n1... e5 2. Nf3 Nc6 *';
  const result = parsePgn(text);
  assert.equal(result.error, "");
  assert.deepEqual(result.game.san, ["e5", "Nf3", "Nc6"]);
});
