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
