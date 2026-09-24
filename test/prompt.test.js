import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMovePrompt,
  buildOpeningPrompt,
  buildRetryPrompt,
  extractBracketedMoves,
  extractMoveCandidates,
  formatMoveList,
  isEchoOfPrompt,
  normaliseUci,
} from "../src/shared/prompt.js";
import { MAX_PROMPT_LENGTH, isExtensionMessage, normaliseResponse, sanitisePrompt } from "../src/shared/messaging.js";

test("move prompts state the side, FEN, move and reply format", () => {
  const prompt = buildMovePrompt({
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    uci: "e2e4",
    san: "e4",
    aiColor: "b",
    history: "1. e4",
  });

  assert.match(prompt, /You are playing BLACK/);
  assert.match(prompt, /FEN\): rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b KQkq e3 0 1/);
  assert.match(prompt, /The human just played e4 \(\[e2e4\]\)/);
  assert.match(prompt, /Moves so far: 1\. e4/);
  assert.match(prompt, /for example \[g8f6\]/);
});

test("move prompts describe the human side correctly when the AI plays White", () => {
  const prompt = buildMovePrompt({
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    uci: "a1a2",
    san: "Ka2",
    aiColor: "w",
  });
  assert.match(prompt, /You are playing WHITE/);
  assert.match(prompt, /human plays Black/);
  assert.match(prompt, /\[a1a2\]/);
});

test("the opening prompt teaches the protocol", () => {
  const prompt = buildOpeningPrompt({ aiColor: "b", fen: "8/8/8/8/8/8/8/K6k w - - 0 1" });
  assert.match(prompt, /Let's play chess/);
  assert.match(prompt, /You are BLACK/);
  assert.match(prompt, /square brackets/);
});

test("retry prompts quote the illegal move and restate the position", () => {
  const prompt = buildRetryPrompt({ fen: "8/8/8/8/8/8/8/K6k w - - 0 1", uci: "e7e5", aiColor: "b" });
  assert.match(prompt, /\[e7e5\] is not legal/);
  assert.match(prompt, /Position \(FEN\)/);
  assert.match(prompt, /exactly one bracketed coordinate move/);
});

test("bracketed moves are extracted first occurrence first, without duplicates", () => {
  const reply = "I played [e7e5] first, but [g8f6] is better. Final: [g8f6].";
  assert.deepEqual(extractBracketedMoves(reply), ["e7e5", "g8f6"]);
  assert.deepEqual(extractBracketedMoves("no moves here"), []);
  assert.deepEqual(extractBracketedMoves("[E2E4]"), ["e2e4"], "case is normalised");
  assert.deepEqual(extractBracketedMoves("[e7e8Q]"), ["e7e8q"]);
  assert.deepEqual(extractBracketedMoves("[z9z9]"), [], "invalid squares are ignored");
  assert.deepEqual(extractBracketedMoves("[hello]"), []);
  assert.deepEqual(extractBracketedMoves(null), []);
  assert.deepEqual(extractBracketedMoves(42), []);
});

test("bare UCI moves are only used when no bracketed move exists", () => {
  assert.deepEqual(extractMoveCandidates("My move is g8f6"), ["g8f6"]);
  assert.deepEqual(extractMoveCandidates("My move is [g8f6] and also e7e5"), ["g8f6"]);
  assert.deepEqual(extractMoveCandidates("nothing to see"), []);
  assert.deepEqual(extractMoveCandidates("x".repeat(30000)), [], "oversized replies are ignored");
});

test("normaliseUci validates and lower-cases", () => {
  assert.equal(normaliseUci(" E2E4 "), "e2e4");
  assert.equal(normaliseUci("e7e8q"), "e7e8q");
  assert.equal(normaliseUci("e2e4x"), "");
  assert.equal(normaliseUci(""), "");
  assert.equal(normaliseUci(undefined), "");
});

test("move lists are rendered in PGN style", () => {
  const moves = [{ san: "e4" }, { san: "e5" }, { san: "Nf3" }, { san: "Nc6" }, { san: "Bb5" }];
  assert.equal(formatMoveList(moves), "1. e4 e5 2. Nf3 Nc6 3. Bb5");
  assert.equal(formatMoveList([]), "");
  assert.equal(formatMoveList(moves, { maxPlies: 2 }), "2... Nc6 3. Bb5");
  assert.equal(formatMoveList([{ san: "e5" }], { blackToMoveFirst: true }), "1... e5");
  assert.equal(formatMoveList([{ uci: "e2e4" }]), "1. e2e4", "falls back to UCI when SAN is missing");
});

test("echoed prompts are recognised", () => {
  const prompt = buildMovePrompt({
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    uci: "a1a2",
    san: "Ka2",
    aiColor: "b",
  });
  assert.ok(isEchoOfPrompt(prompt, prompt));
  assert.ok(isEchoOfPrompt(`${prompt}\n`, prompt));
  assert.ok(!isEchoOfPrompt("My move is [g8f6].", prompt));
  assert.ok(!isEchoOfPrompt("", prompt));
  assert.ok(!isEchoOfPrompt("anything", ""));
});

test("prompts are bounded before they reach a chat box", () => {
  const long = "x".repeat(MAX_PROMPT_LENGTH + 500);
  assert.equal(sanitisePrompt(long).length, MAX_PROMPT_LENGTH);
  assert.equal(sanitisePrompt(`  hello\u0000  `), "hello");
  assert.equal(sanitisePrompt(undefined), "");
  assert.equal(sanitisePrompt(42), "");
});

test("runtime messages are recognised and responses normalised", () => {
  assert.ok(isExtensionMessage({ type: "AI_MOVE", move: "e7e5" }));
  assert.ok(!isExtensionMessage({ type: "UNKNOWN" }));
  assert.ok(!isExtensionMessage(null));
  assert.ok(!isExtensionMessage("AI_MOVE"));

  assert.deepEqual(normaliseResponse({ ok: true, method: "button" }), {
    ok: true,
    error: "",
    method: "button",
  });
  assert.deepEqual(normaliseResponse({ ok: false, error: "boom" }), { ok: false, error: "boom" });
  assert.equal(normaliseResponse(undefined).ok, false);
  assert.equal(normaliseResponse({ ok: false }).error, "The request failed.");
});

test("retry correction includes reason, hyphenated legal set, history and rejected moves", () => {
  const prompt = buildRetryPrompt({
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    uci: "a1a5",
    aiColor: "w",
    history: "1. e4 e5",
    reason: { code: "blocked", facts: { from: "a1", to: "a5", blocker: "a2" } },
    legalMoves: ["e2e4", "g1f3", "a2a4"],
    rejectedMoves: ["a1a5", "b1b5"],
  });
  assert.match(prompt, /The move \[a1a5\] is not legal/);
  assert.match(prompt, /path is blocked at a2/);
  assert.match(prompt, /Position \(FEN\):/);
  assert.match(prompt, /Side to move: WHITE/);
  assert.match(prompt, /Moves so far: 1\. e4 e5/);
  assert.match(prompt, /Legal moves \(3 total\): e2-e4 g1-f3 a2-a4/);
  assert.ok(!prompt.includes("[e2e4]"));
  assert.match(prompt, /a1-a5, b1-b5/);
  assert.match(prompt, /Put the bracketed move first\. No second bracketed move/);
  assert.ok(isEchoOfPrompt(prompt, prompt));
  assert.deepEqual(extractMoveCandidates(prompt), [], "a retry prompt echo is never a played move");
});

test("long legal move lists retain their reason and count, and state truncation within 4000 chars", () => {
  const moves = Array.from({ length: 700 }, (_, index) => (index % 2 ? "e2e4" : "g1f3"));
  const prompt = buildRetryPrompt({
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    uci: "a1a5",
    aiColor: "w",
    history: "1. e4 ".repeat(500),
    reason: { code: "blocked", facts: { blocker: "a2" } },
    legalMoves: moves,
    rejectedMoves: ["a1a5"],
  });
  assert.ok(prompt.length <= MAX_PROMPT_LENGTH);
  assert.match(prompt, /blocked at a2/);
  assert.match(prompt, /Legal moves \(700 total\)/);
  assert.match(prompt, /list truncated/);
});

test("first bracketed UCI wins; bare fallback is disabled for quoted legal lists", () => {
  assert.deepEqual(extractMoveCandidates("[e2e4] [d2d4]"), ["e2e4", "d2d4"]);
  assert.deepEqual(extractMoveCandidates("Legal moves (2 total): e2e4 d2d4"), []);
  assert.deepEqual(extractMoveCandidates("The move [e2e4] is not legal. Reply [d2d4]."), []);
  assert.deepEqual(extractMoveCandidates("I play e2e4"), ["e2e4"]);
});
