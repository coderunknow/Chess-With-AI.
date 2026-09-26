// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { buildMovePrompt, buildOpeningPrompt, extractCommentary, extractMoveCandidates } from "../src/shared/prompt.js";
import { DEFAULT_SETTINGS, normaliseSettings, PROMPT_STYLES } from "../src/shared/settings.js";
import { bootApp } from "./helpers/boot-app.js";

test("Explain defaults to short and invalid values are repaired", () => {
  assert.equal(DEFAULT_SETTINGS.explainMode, "short");
  assert.equal(normaliseSettings({ explainMode: "invalid" }).explainMode, "short");
  assert.equal(normaliseSettings({ explainMode: "full" }).explainMode, "full");
  assert.equal(normaliseSettings({ explainMode: "off" }).explainMode, "off");
  assert.equal(normaliseSettings({}).explainMode, "short");
});

test("commentary extraction is display-only and strips move/protocol noise", () => {
  const reply = "Thinking: **Develops the knight** [g8f6]. ```analysis``` The position is balanced.";
  assert.equal(extractCommentary(reply, { move: "g8f6" }), "Develops the knight. The position is balanced.");
  assert.deepEqual(extractMoveCandidates(reply), ["g8f6"]);
});

test("removing a move token never leaves dangling punctuation or an empty shell", () => {
  const cases = [
    ["I play [e7e5]. This opens the centre for the bishops.", "e7e5", "This opens the centre for the bishops."],
    // SAN mentions are prose, not UCI tokens: they are kept verbatim.
    ["[g8f6] I develop the knight and attack the e4 pawn.", "g8f6", "I develop the knight and attack the e4 pawn."],
    ["I choose [e7e6], the French Defence.", "e7e6", "I choose, the French Defence."],
    ["**[c2c4]** — the English opening, flexible and solid.", "c2c4", "the English opening, flexible and solid."],
    [
      "Playing [a7a5] to stop your expansion on the queenside.",
      "a7a5",
      "Playing to stop your expansion on the queenside.",
    ],
    ["[e2e4]", "e2e4", ""],
  ];
  for (const [reply, move, expected] of cases) {
    assert.equal(extractCommentary(reply, { move }), expected, `reply: ${reply}`);
  }
  // The residue repair is cosmetic only: parsing still sees the real move.
  assert.deepEqual(extractMoveCandidates("I play [e7e5]. This opens the centre."), ["e7e5"]);
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

test("short explain adds one-line reason for standard/concise but not efficient", () => {
  const base = {
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    uci: "e2e4",
    san: "e4",
    aiColor: "b",
    history: "1. e4",
    explainMode: "short",
  };
  const standard = buildMovePrompt({ ...base, style: PROMPT_STYLES.STANDARD });
  assert.match(standard, /one short reason/i);
  assert.doesNotMatch(standard, /\(ply /); // plyCount default 0 — no move line
  const withPly = buildMovePrompt({ ...base, plyCount: 1, style: PROMPT_STYLES.STANDARD });
  assert.match(withPly, /Move 1 \(ply 1\)/);

  const efficient = buildMovePrompt({ ...base, style: PROMPT_STYLES.EFFICIENT });
  assert.doesNotMatch(efficient, /one short reason/i);
  assert.match(efficient, /No commentary or extra text/i);

  const full = buildMovePrompt({ ...base, style: PROMPT_STYLES.STANDARD, explainMode: "full" });
  assert.doesNotMatch(full, /one short reason/i);

  const opening = buildOpeningPrompt({ aiColor: "w", fen: base.fen, explainMode: "short" });
  assert.match(opening, /one short reason/i);
});

test("opponentIsEngine wording is distinct from human and AI-vs-AI", () => {
  const base = {
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    uci: "e2e4",
    san: "e4",
    aiColor: "b",
  };
  const engine = buildMovePrompt({ ...base, opponentIsEngine: true });
  assert.match(engine, /local chess engine/i);
  assert.match(engine, /The engine just played/i);
  const ai = buildMovePrompt({ ...base, opponentIsAi: true });
  assert.match(ai, /another AI/i);
  const human = buildMovePrompt(base);
  assert.match(human, /The human just played/i);
});

test("commentary is live-only: shown in memory, never written to storage", async () => {
  const { app, state, teardown } = await bootApp();
  try {
    await app.updateSettings({ explainMode: "short", persistGame: true });
    assert.equal(app.session.playHumanMove("e2e4").ok, true);
    const beforeWrites = state.writes.length;
    await app.handleAiMove({
      move: "e7e5",
      candidates: ["e7e5"],
      text: "I play [e7e5]. This opens the center for the bishops.",
      commentary: "This opens the center for the bishops.",
    });
    const snap = app.inspectState();
    assert.equal(snap.commentary, "This opens the center for the bishops.");
    assert.match(app.session.fen, /rnbqkbnr\/pppp1ppp/);
    // Every storage write after the reply must be free of commentary text.
    for (const write of state.writes.slice(beforeWrites)) {
      const blob = JSON.stringify(write);
      assert.equal(
        /opens the center|This opens/.test(blob),
        false,
        `commentary leaked into storage: ${blob.slice(0, 240)}`,
      );
    }
    // Lifecycle: undo clears live commentary.
    app.undo();
    assert.equal(app.inspectState().commentary, "");
  } finally {
    teardown();
  }
});

test("inspectState reports PLAY with no violations on a fresh boot", async () => {
  const { app, teardown } = await bootApp();
  try {
    const snap = app.inspectState();
    assert.equal(snap.mode, "PLAY");
    assert.deepEqual(snap.violations, []);
    assert.equal(snap.commentary, "");
  } finally {
    teardown();
  }
});

test("the thinking card renders live commentary and hides when Explain is off", async () => {
  const { app, refs, teardown } = await bootApp();
  try {
    const card = refs["thinking-card"];
    const body = refs["thinking-card-body"];
    assert.equal(card.hidden, true, "hidden on a fresh board");

    await app.updateSettings({ explainMode: "short" });
    app.session.playHumanMove("e2e4");
    await app.handleAiMove({
      move: "e7e5",
      candidates: ["e7e5"],
      text: "I play [e7e5]. This opens the centre for the bishops.",
    });
    assert.equal(card.hidden, false);
    assert.equal(body.textContent, "This opens the centre for the bishops.");
    assert.equal(refs["thinking-card-summary"].textContent, "AI's thinking");

    await app.updateSettings({ explainMode: "off" });
    assert.equal(card.hidden, true, "off hides the card immediately");
    assert.equal(app.inspectState().commentary, "");
  } finally {
    teardown();
  }
});

test("the Explain select persists its choice and is restored on render", async () => {
  const { app, refs, state, teardown } = await bootApp();
  try {
    const select = refs["settings-explain-mode"];
    assert.equal(select.value, "short", "default shown");
    select.value = "full";
    select.dispatchEvent({ type: "change", target: select });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(app.settings.explainMode, "full");
    const stored = state.writes.filter((write) => write.key === "settings").at(-1);
    assert.equal(stored?.value?.explainMode, "full", "choice survives a reload");
    assert.equal(select.value, "full", "render keeps the control in sync");
  } finally {
    teardown();
  }
});
