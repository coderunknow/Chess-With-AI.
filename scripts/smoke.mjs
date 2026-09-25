#!/usr/bin/env node
/**
 * Development smoke test.
 *
 * Drives the whole stack — content bridge, service worker wiring and the chess
 * core — against the DOM/API doubles used by the unit tests, then plays a short
 * scripted game and prints the result. Also exercises the privacy-safe latency
 * timeline and prints its stage breakdown. Useful as a fast "does anything
 * obviously break" check before loading the extension in Chrome.
 *
 * Usage: `npm run dev:smoke`
 *
 * @module scripts/smoke
 */

import { installFakeChrome } from "../test/helpers/fake-chrome.js";
import { installFakeDom } from "../test/helpers/fake-dom.js";
import { Position } from "../src/core/position.js";
import { toUci } from "../src/core/move.js";
import { buildMovePrompt, extractMoveCandidates } from "../src/shared/prompt.js";
import { LATENCY_STAGES, LatencyTimeline, formatLatencyReport, validateTimelineEntry } from "../src/shared/latency.js";

/** A short, legal game used as the fixture. */
const SCRIPT = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"];

const dom = installFakeDom();
const fake = installFakeChrome();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const { ChatBridge } = await import("../src/content/bridge.js");
  const bridge = new ChatBridge({ hostname: "chatgpt.com", inputTimeout: 50 });

  const position = Position.start();
  console.log("Smoke test — scripted game against the stubs\n");

  const played = [];
  for (const [index, uci] of SCRIPT.entries()) {
    const move = position.moveFromUci(uci);
    if (!move) {
      throw new Error(`the fixture move ${uci} is not legal at ply ${index + 1}`);
    }
    if (index % 2 === 0) {
      played.push(`${index / 2 + 1}. ${uci}`);
    } else {
      played[played.length - 1] += ` ${uci}`;
    }
    position.makeMove(move, { validate: false });
    const expected = index % 2 === 0 ? "b" : "w";
    if (position.turn !== expected) {
      throw new Error(`turn after ${uci} should be ${expected}`);
    }
  }
  console.log(`${played.join("  ")}\n`);

  const prompt = buildMovePrompt({
    fen: position.toFen(),
    uci: SCRIPT.at(-1),
    san: "a6",
    aiColor: position.turn,
    history: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6",
  });

  if (!prompt.includes(`[${SCRIPT.at(-1)}]`) || !prompt.includes(position.toFen())) {
    throw new Error("the prompt must contain the exact human move and current FEN");
  }
  if (extractMoveCandidates(prompt).length !== 0) {
    throw new Error("a quoted prompt must never be parsed as an assistant reply");
  }

  const reply = `Sure! I play [b5a4]. Position after: ${position.toFen()}`;
  const replyCandidates = extractMoveCandidates(reply);
  if (replyCandidates[0] !== "b5a4") {
    throw new Error(`expected b5a4 from the sample reply, got ${replyCandidates.join(", ")}`);
  }

  const aiMove = position.moveFromUci(replyCandidates[0]);
  if (!aiMove) {
    throw new Error("the parsed AI move should be legal");
  }
  position.makeMove(aiMove, { validate: false });

  console.log(`prompt                 ${prompt.split("\n").length} lines, ${prompt.length} characters`);
  console.log(`parsed AI reply        ${toUci(aiMove)}`);
  console.log(`position after reply   ${position.toFen()}`);
  console.log(`legal moves available  ${position.legalMoves().length}`);

  if (!bridge) {
    throw new Error("the chat bridge did not construct");
  }

  // --- Latency timeline: one real send round-trip with stage breakdown -------
  console.log("\nLatency timeline — stage breakdown\n");
  const { document } = dom;
  const container = document.createElement("div");
  document.body.append(container);
  const input = document.createElement("textarea", { selectors: ["textarea"] });
  container.append(input);
  document.register(input, input.selectorMatches);
  const send = document.createElement("button", { selectors: ["button[aria-label*='Send' i]"] });
  send.setAttribute("aria-label", "Send message");
  send.addEventListener("click", () => {
    // A real host renders the user echo and clears the composer after submit.
    const echo = document.createElement("div", { selectors: ["[data-message-author-role='user']"] });
    echo.textContent = input.value;
    document.register(echo, echo.selectorMatches);
    container.append(echo);
    input.value = "";
  });
  container.append(send);
  document.register(send, send.selectorMatches);

  const timeline = new LatencyTimeline();
  const sendBridge = new ChatBridge({ hostname: "chatgpt.com", inputTimeout: 200, submitSettleMs: 250 });
  timeline.begin(); // queued
  await delay(2);
  timeline.mark("dispatched");
  const result = await sendBridge.send(prompt);
  if (!result.ok) {
    throw new Error(`the smoke send failed: ${result.error}`);
  }
  timeline.mergeExternal(result.diagnostics.stages);
  await delay(3);
  timeline.mark("reply-detected"); // the watcher scan point in the real pipeline
  timeline.mark("parsed");
  timeline.mark("accepted");
  timeline.mark("rendered");
  const entry = timeline.finish();
  if (!entry) {
    throw new Error("the latency entry was incomplete — stages did not all record");
  }
  const verdict = validateTimelineEntry(entry);
  if (!verdict.ok) {
    throw new Error(`latency entry invalid: ${verdict.problems.join("; ")}`);
  }
  for (let i = 0; i < LATENCY_STAGES.length; i += 1) {
    console.log(`  ${LATENCY_STAGES[i].padEnd(15)} +${String(entry.deltasMs[i]).padStart(5)} ms`);
  }
  console.log(`  ${"total".padEnd(15)} +${String(entry.totalMs).padStart(5)} ms`);
  console.log("");
  console.log(formatLatencyReport([entry]));

  console.log("\nSmoke test passed.");
} catch (error) {
  console.error(`\nSmoke test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  dom.restore();
  fake.restore();
}
