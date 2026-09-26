// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { extractCommentary, extractMoveCandidates } from "../src/shared/prompt.js";
import { DEFAULT_SETTINGS, normaliseSettings } from "../src/shared/settings.js";

test("Explain defaults to short and invalid values are repaired", () => {
  assert.equal(DEFAULT_SETTINGS.explainMode, "short");
  assert.equal(normaliseSettings({ explainMode: "invalid" }).explainMode, "short");
  assert.equal(normaliseSettings({ explainMode: "full" }).explainMode, "full");
});

test("commentary extraction is display-only and strips move/protocol noise", () => {
  const reply = "Thinking: **Develops the knight** [g8f6]. ```analysis``` The position is balanced.";
  assert.equal(extractCommentary(reply, { move: "g8f6" }), "Develops the knight . The position is balanced.");
  assert.deepEqual(extractMoveCandidates(reply), ["g8f6"]);
});

test("commentary strips prompt echoes, is bounded, and never parses alternate moves", () => {
  const prompt = "Position (FEN): a very long authoritative position and protocol text";
  const result = extractCommentary(`${prompt} [e7e5] A clear central response. [d7d5]`, {
    prompts: [prompt],
    maxChars: 20,
  });
  assert.equal(result, "A clear central resp");
  assert.equal(extractMoveCandidates(result).length, 0);
});
