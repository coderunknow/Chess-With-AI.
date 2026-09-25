import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMovePrompt,
  buildOpeningPrompt,
  buildRetryPrompt,
  buildTurnPrompt,
  describePromptMetrics,
  extractMoveCandidates,
  isEchoOfPrompt,
} from "../src/shared/prompt.js";
import { PROMPT_STYLES } from "../src/shared/settings.js";
import { buildStudioPreview } from "../src/ui/studio.js";
import { bootApp } from "./helpers/boot-app.js";

const BASE = {
  fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  uci: "e2e4",
  san: "e4",
  aiColor: "b",
  history: "1. e4",
};

test("efficient mode asks for a move-only reply and keeps every decision cue", () => {
  const prompt = buildMovePrompt({ ...BASE, style: PROMPT_STYLES.EFFICIENT });
  // Decision context is never stripped.
  assert.match(prompt, /FEN\): rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b KQkq e3 0 1/);
  assert.match(prompt, /Moves so far: 1\. e4/);
  assert.match(prompt, /\[e2e4\]/);
  // Move-only output contract in the existing UCI-in-brackets format.
  assert.match(prompt, /\[g8f6\]/, "the reply format example stays");
  assert.match(prompt, /No commentary or extra text/i);
  assert.match(prompt, /exactly one legal move/i, "the one-move rule stays");
  // An efficient reply is just the move token — bracketed or bare UCI.
  assert.deepEqual(extractMoveCandidates("[g8f6]"), ["g8f6"]);
  assert.deepEqual(extractMoveCandidates("g8f6"), ["g8f6"]);
  // Echo protection must recognise all style variants as prompts.
  assert.equal(isEchoOfPrompt(prompt, prompt), true);
});

test("fun mode asks for 1-2 witty sentences after the move, sized by the slider", () => {
  const one = buildMovePrompt({ ...BASE, style: PROMPT_STYLES.FUN, funSentences: 1 });
  const two = buildMovePrompt({ ...BASE, style: PROMPT_STYLES.FUN, funSentences: 2 });
  assert.match(one, /1 short witty sentence/i);
  assert.match(two, /2 short witty sentences/i);
  assert.match(one, /after the move/i, "commentary comes after the move");
  assert.match(two, /square brackets/i, "commentary must not smuggle fake moves");
  // Out-of-range slider values clamp instead of leaking into the prompt.
  const clamped = buildMovePrompt({ ...BASE, style: PROMPT_STYLES.FUN, funSentences: 9 });
  assert.match(clamped, /2 short witty sentences/i);

  // Commentary never interferes with parsing: the first bracketed move wins.
  const witty = "I play [g8f6]. The knight hops out like it is late for dinner. What a position!";
  assert.deepEqual(extractMoveCandidates(witty), ["g8f6"]);
  const tricky = "[g8f6] first! Compare [b8c6], but no — the knight to f6 is my move.";
  assert.equal(extractMoveCandidates(tricky)[0], "g8f6", "the first bracketed move is the reply");
});

test("efficient and fun prompts share the standard move context — only the output tail differs", () => {
  const standard = buildMovePrompt({ ...BASE, style: PROMPT_STYLES.STANDARD });
  for (const style of [PROMPT_STYLES.CONCISE, PROMPT_STYLES.EFFICIENT, PROMPT_STYLES.FUN]) {
    const prompt = buildMovePrompt({ ...BASE, style, funSentences: 2 });
    for (const cue of ["Chess move request", BASE.fen, "[e2e4]", "BLACK"]) {
      assert.ok(prompt.includes(cue), `${style} must keep the decision cue ${cue}`);
    }
  }
  assert.ok(standard.includes("The human just played e4"));
  // Reply grammar is immutable: exactly one move, UCI in square brackets.
  for (const prompt of [
    standard,
    buildMovePrompt({ ...BASE, style: PROMPT_STYLES.EFFICIENT }),
    buildMovePrompt({ ...BASE, style: PROMPT_STYLES.FUN }),
    buildMovePrompt({ ...BASE, style: PROMPT_STYLES.CONCISE }),
  ]) {
    assert.match(prompt, /\[g8f6\]/);
    assert.doesNotMatch(prompt, /respond with (two|multiple)/i);
  }
});

test("the battle clock context appears in every style and is never stripped by concision", () => {
  const battleClock = { remainingMs: 5 * 60 * 1000, incrementSec: 3 };
  for (const style of Object.values(PROMPT_STYLES)) {
    const prompt = buildMovePrompt({ ...BASE, style, funSentences: 2, battleClock });
    assert.match(prompt, /You have 05:00 left; your increment is 3s\./, `missing clock line in ${style}`);
  }
  const opening = buildOpeningPrompt({ aiColor: "b", fen: BASE.fen, battleClock });
  assert.match(opening, /You have 05:00 left; your increment is 3s\./);
  const retry = buildRetryPrompt({ fen: BASE.fen, uci: "e7e5", aiColor: "b", battleClock });
  assert.match(retry, /You have 05:00 left; your increment is 3s\./);
});

test("buildTurnPrompt picks the opening prompt at ply 0 and the move prompt afterwards", () => {
  const opening = buildTurnPrompt({ aiColor: "w", fen: BASE.fen, plyCount: 0 });
  assert.equal(opening, buildOpeningPrompt({ aiColor: "w", fen: BASE.fen }));
  const turn = buildTurnPrompt({ ...BASE, plyCount: 1 });
  assert.equal(turn, buildMovePrompt({ ...BASE }));
});

test("prompt metrics report chars/lines and flag the size budget", () => {
  const prompt = buildTurnPrompt({ ...BASE, plyCount: 1 });
  const metrics = describePromptMetrics(prompt);
  assert.equal(metrics.chars, prompt.length);
  assert.equal(metrics.lines, prompt.split("\n").length);
  assert.equal(typeof metrics.overBudget, "boolean");
  const huge = describePromptMetrics("x".repeat(900));
  assert.equal(huge.overBudget, true, "anything past the ~800 char budget warns");
  assert.equal(describePromptMetrics(prompt).overBudget, prompt.length > 800);
});

test("the Prompt Studio preview is byte-for-byte the send-path prompt", () => {
  for (const style of Object.values(PROMPT_STYLES)) {
    const context = { ...BASE, plyCount: 1, style, funSentences: 2 };
    const studio = buildStudioPreview({ context, platformLabel: "ChatGPT" });
    assert.equal(studio.text, buildTurnPrompt(context), `studio must match the builder for ${style}`);
    assert.equal(studio.metrics.chars, studio.text.length);
  }
});

test("App.studioPreview equals the prompt the App actually dispatches", async () => {
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(12); // e2
    await app.selectSquare(28); // e4 → one prompt dispatched
    const [sent] = env.prompts();
    assert.ok(sent, "a prompt must have been dispatched");
    assert.equal(app.studioPreview().text, sent.message.prompt, "studio output === send-path prompt, byte-for-byte");
  } finally {
    env.teardown();
  }
});

test("efficient and fun reply contracts survive the retry prompt unchanged", () => {
  const retry = buildRetryPrompt({ fen: BASE.fen, uci: "e7e5", aiColor: "b", style: PROMPT_STYLES.EFFICIENT });
  assert.match(retry, /exactly one bracketed coordinate move/);
  assert.match(retry, /Put the bracketed move first\. No second bracketed move\./);
  assert.match(retry, /No commentary or extra text/i);
  const funRetry = buildRetryPrompt({
    fen: BASE.fen,
    uci: "e7e5",
    aiColor: "b",
    style: PROMPT_STYLES.FUN,
    funSentences: 1,
  });
  assert.match(funRetry, /1 short witty sentence/i);
  assert.deepEqual(extractMoveCandidates(funRetry), [], "a retry echo is never a played move");
});

// ---------------------------------------------------------------------------
// v0.7.2 — prompt + context engineering (additive only)
// ---------------------------------------------------------------------------

const V072_STYLES = [PROMPT_STYLES.STANDARD, PROMPT_STYLES.CONCISE, PROMPT_STYLES.EFFICIENT, PROMPT_STYLES.FUN];

test("v0.7.2: every move prompt states the side to move and asks for the move visibly, as plain text", () => {
  for (const style of V072_STYLES) {
    const prompt = buildMovePrompt({ ...BASE, style, funSentences: 1 });
    assert.match(prompt, /^Side to move: BLACK\.$/m, `${style}: explicit side to move`);
    assert.match(
      prompt,
      /visible chat reply as plain text, not in a code block/,
      `${style}: show the move in the chat`,
    );
    assert.match(prompt, /\[e7e8q\]/, `${style}: promotion shape is spelled out`);
    // Additive only: all v0.7.1 decision context is still present.
    for (const cue of ["Chess move request", `Position (FEN): ${BASE.fen}`, "Moves so far: 1. e4", "[e2e4]"]) {
      assert.ok(prompt.includes(cue), `${style} keeps ${cue}`);
    }
    // Still prompt-shaped (echo protection) and never parsed as a reply.
    assert.equal(isEchoOfPrompt(prompt, prompt), true);
    assert.deepEqual(extractMoveCandidates(prompt), []);
  }
});

test("v0.7.2: the opening prompt (AI to move at ply 0) asks for the first move NOW, visibly", () => {
  for (const style of V072_STYLES) {
    const prompt = buildOpeningPrompt({
      aiColor: "w",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      style,
    });
    assert.match(prompt, /^Side to move: WHITE\.$/m);
    assert.match(prompt, /It is your move now/, `${style}: a protocol-only opener invited 'Ready when you are!'`);
    assert.match(prompt, /visible chat reply as plain text, not in a code block/);
    assert.match(prompt, /Let's play chess\. You are WHITE/, "existing protocol text stays");
    assert.deepEqual(extractMoveCandidates(prompt), []);
  }
});

test("v0.7.2: the corrective retry prompt also asks for a visible plain-text move and keeps every cue", () => {
  const retry = buildRetryPrompt({
    fen: BASE.fen,
    uci: "e2e4",
    aiColor: "b",
    history: "1. e4",
    legalMoves: ["g8f6", "e7e5"],
    rejectedMoves: ["e2e4"],
    battleClock: { remainingMs: 60000, incrementSec: 1 },
  });
  assert.match(retry, /visible chat reply as plain text, not in a code block/);
  for (const cue of [`Position (FEN): ${BASE.fen}`, "Side to move: BLACK.", "Legal moves (2 total): g8-f6 e7-e5"]) {
    assert.ok(retry.includes(cue), `retry keeps ${cue}`);
  }
  assert.match(retry, /Previously rejected UCIs \(do not repeat\): e2-e4\./);
  assert.match(retry, /You have 01:00 left/);
});

test("v0.7.2: typical prompts stay within the 800-char budget and the Studio stays byte-identical", () => {
  const history = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5";
  for (const style of V072_STYLES) {
    const context = { ...BASE, history, plyCount: 12, style, funSentences: 2 };
    const prompt = buildTurnPrompt(context);
    assert.equal(describePromptMetrics(prompt).overBudget, false, `${style} is ${prompt.length} chars`);
    assert.equal(buildStudioPreview({ context, platformLabel: "Claude" }).text, prompt);
  }
  const opening = buildTurnPrompt({ aiColor: "w", fen: BASE.fen, plyCount: 0, style: PROMPT_STYLES.FUN });
  assert.equal(describePromptMetrics(opening).overBudget, false);
});
