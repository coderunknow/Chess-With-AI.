import assert from "node:assert/strict";
import test from "node:test";

import {
  LATENCY_RING_SIZE,
  LATENCY_STAGES,
  LatencyTimeline,
  formatLatencyReport,
  markStage,
  validateTimelineEntry,
} from "../src/shared/latency.js";

/** Builds a timeline driven by a controllable monotonic clock. */
function scriptedTimeline() {
  let now = 1000;
  const timeline = new LatencyTimeline({ clock: () => now });
  return {
    timeline,
    advance(ms) {
      now += ms;
      return now;
    },
  };
}

test("a completed move records every stage as non-negative, ordered, finite deltas", () => {
  const { timeline, advance } = scriptedTimeline();
  timeline.begin();
  advance(5);
  timeline.mark("dispatched");
  advance(30);
  timeline.mark("submitted");
  advance(25);
  timeline.mark("echo-observed");
  advance(900);
  timeline.mark("reply-detected");
  advance(1);
  timeline.mark("parsed");
  advance(2);
  timeline.mark("accepted");
  advance(3);
  timeline.mark("rendered");
  const entry = timeline.finish();

  assert.ok(entry, "a fully marked move must be recorded");
  assert.deepEqual(entry.stages, [...LATENCY_STAGES]);
  assert.equal(entry.deltasMs.length, LATENCY_STAGES.length);
  assert.deepEqual(entry.deltasMs, [0, 5, 35, 60, 960, 961, 963, 966]);
  assert.equal(entry.totalMs, 966);
  assert.equal(entry.gapFromPreviousMs, null);

  for (const delta of entry.deltasMs) {
    assert.ok(Number.isFinite(delta), "no stage may be NaN or infinite");
    assert.ok(delta >= 0, "no stage may be negative");
  }
  for (let i = 1; i < entry.deltasMs.length; i += 1) {
    assert.ok(entry.deltasMs[i] >= entry.deltasMs[i - 1], "stage deltas must be monotonic");
  }
  const verdict = validateTimelineEntry(entry);
  assert.equal(verdict.ok, true, verdict.problems.join("; "));
});

test("the timeline asserts stage presence and ordering, never wall-clock speed", () => {
  const missing = {
    stages: ["queued", "dispatched", "rendered"],
    deltasMs: [0, 4, 9],
    totalMs: 9,
    gapFromPreviousMs: null,
  };
  assert.equal(validateTimelineEntry(missing).ok, false, "missing stages are invalid");

  const reversed = {
    stages: [...LATENCY_STAGES],
    deltasMs: [0, 50, 40, 41, 42, 43, 44, 45],
    totalMs: 45,
    gapFromPreviousMs: null,
  };
  assert.equal(validateTimelineEntry(reversed).ok, false, "out-of-order stages are invalid");

  const negative = {
    stages: [...LATENCY_STAGES],
    deltasMs: [0, -1, 2, 3, 4, 5, 6, 7],
    totalMs: 7,
    gapFromPreviousMs: null,
  };
  assert.equal(validateTimelineEntry(negative).ok, false, "negative deltas are invalid");

  const nan = {
    stages: [...LATENCY_STAGES],
    deltasMs: [0, 1, 2, Number.NaN, 4, 5, 6, 7],
    totalMs: 7,
    gapFromPreviousMs: null,
  };
  assert.equal(validateTimelineEntry(nan).ok, false, "NaN deltas are invalid");

  // A slow machine must NOT fail validation: only structure is asserted.
  const slow = {
    stages: [...LATENCY_STAGES],
    deltasMs: [0, 50_000, 90_000, 120_000, 240_000, 240_001, 240_010, 240_020],
    totalMs: 240_020,
    gapFromPreviousMs: 180_000,
  };
  assert.equal(validateTimelineEntry(slow).ok, true, "duration is never asserted");
});

test("incomplete moves are never recorded — presence is required", () => {
  const { timeline, advance } = scriptedTimeline();
  timeline.begin();
  advance(10);
  timeline.mark("dispatched");
  advance(10);
  timeline.mark("accepted");
  assert.equal(timeline.finish(), null, "a move missing stages must not enter the ring");
  assert.deepEqual(timeline.entries, []);
});

test("marks are first-wins so late external reports cannot rewrite a stage", () => {
  const { timeline, advance } = scriptedTimeline();
  timeline.begin();
  advance(10);
  timeline.mark("dispatched");
  advance(10);
  timeline.mark("dispatched"); // duplicate ignored
  // Content-side stages arrive late via payloads but carry event timestamps.
  timeline.mergeExternal({ submitted: 1025, "echo-observed": 1030, "reply-detected": 1040 });
  timeline.mergeExternal({ submitted: 9999, "echo-observed": 9999, "reply-detected": 9999 });
  advance(20);
  timeline.mark("parsed");
  advance(5);
  timeline.mark("accepted");
  advance(5);
  timeline.mark("rendered");
  const entry = timeline.finish();
  assert.ok(entry);
  const submitted = entry.deltasMs[LATENCY_STAGES.indexOf("submitted")];
  assert.equal(submitted, 25, "the first observation of each stage wins");
  assert.equal(validateTimelineEntry(entry).ok, true);
});

test("the ring keeps only the most recent moves and the export is privacy-safe", () => {
  const { timeline, advance } = scriptedTimeline();
  for (let i = 0; i < LATENCY_RING_SIZE + 5; i += 1) {
    timeline.begin();
    for (const stage of LATENCY_STAGES.slice(1)) {
      advance(1);
      timeline.mark(stage);
    }
    const entry = timeline.finish();
    if (i === 1) assert.equal(entry.gapFromPreviousMs, 0, "gap is measured from the previous render");
  }
  const entries = timeline.entries;
  assert.equal(entries.length, LATENCY_RING_SIZE, "the buffer is bounded");

  const report = formatLatencyReport(entries);
  assert.ok(report.includes("queued"), "stage names are shown");
  assert.ok(/rendered=\d+/.test(report), "numeric deltas are shown");
  // Privacy: entries may only carry stage names and numbers — nothing else.
  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), ["deltasMs", "gapFromPreviousMs", "stages", "totalMs"]);
    for (const delta of [...entry.deltasMs, entry.totalMs]) {
      assert.equal(typeof delta, "number");
    }
  }
  // The redacted export contains no free-form payload fields.
  assert.doesNotMatch(report, /FEN|prompt|title|http|tab/i);
});

test("markStage records first-wins epoch timestamps on a plain stage map", () => {
  const stages = {};
  markStage(stages, "submitted", 100);
  markStage(stages, "submitted", 500);
  markStage(stages, "echo-observed", 150);
  markStage(stages, "not-a-stage", 1);
  assert.deepEqual(stages, { submitted: 100, "echo-observed": 150 });
});

test("a full App send round-trip records all stages in order (presence + monotonicity only)", async () => {
  const { bootApp } = await import("./helpers/boot-app.js");
  const env = await bootApp();
  const realNow = Date.now;
  let now = 10_000;
  try {
    const { app } = env;
    Date.now = () => now;
    await app.selectSquare(12); // e2
    await app.selectSquare(28); // e4 → prompt queued + dispatched
    assert.equal(env.prompts().length, 1);

    // Content-side stages arrive with the reply payload; they carry event
    // timestamps (never text) and merge first-wins.
    now = 10_040;
    await app.handleAiMove({
      move: "e7e5",
      diagnostics: {
        stages: { submitted: 10_010, "echo-observed": 10_015, "reply-detected": 10_038 },
      },
    });

    const entries = app.latency.entries;
    assert.equal(entries.length, 1, "one accepted move records one entry");
    const verdict = validateTimelineEntry(entries[0]);
    assert.equal(verdict.ok, true, verdict.problems.join("; "));
    assert.deepEqual(entries[0].stages, [...LATENCY_STAGES], "stage names appear in canonical order");
    assert.deepEqual(
      entries[0].deltasMs.map((d) => d >= 0 && Number.isFinite(d)),
      LATENCY_STAGES.map(() => true),
      "no stage may be negative/NaN",
    );
  } finally {
    Date.now = realNow;
    env.teardown();
  }
});

test("badge, sound and announcements run off the accept critical path (bare setTimeout)", async () => {
  const { bootApp } = await import("./helpers/boot-app.js");
  const env = await bootApp();
  try {
    const { app } = env;
    await app.selectSquare(12);
    await app.selectSquare(28);
    const badgeCount = () => env.state.runtimeMessages.filter((m) => m.type === "GAME_STATE_CHANGED").length;
    const before = badgeCount();
    await app.handleAiMove({ move: "e7e5" });
    assert.equal(badgeCount(), before, "badge updates must not sit on the accept critical path");
    assert.equal(app.session.lastMove.uci, "e7e5", "the move itself is accepted synchronously");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(badgeCount() > before, "the badge still updates — scheduled off the critical path");
  } finally {
    env.teardown();
  }
});
