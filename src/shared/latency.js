/**
 * Privacy-safe latency timeline.
 *
 * Records per-accepted-move stage timestamps as millisecond deltas in a small
 * ring buffer so the Diagnostics section can explain exactly how long each part
 * of a send round-trip took. Entries carry ONLY stage names and numbers — never
 * message text, FENs, titles or URLs.
 *
 * Stages (one entry spans one prompt round-trip):
 * - queued           the request entered the send pipeline
 * - dispatched       SEND_CHESS_PROMPT was addressed to the tab
 * - submitted        the ONE submit event fired in the chat composer
 * - echo-observed    the user-message echo confirmed the prompt reached chat
 * - reply-detected   the transcript watcher scanned a new assistant reply
 * - parsed           a UCI candidate was extracted from the reply
 * - accepted         the chess engine applied the move
 * - rendered         the panel painted the resulting position
 *
 * Durations are never asserted in CI: tests check presence, ordering and
 * monotonicity of the stages plus "no stage may be negative/NaN" only.
 *
 * @module shared/latency
 */

/** Canonical stage order for one accepted move. */
export const LATENCY_STAGES = Object.freeze([
  "queued",
  "dispatched",
  "submitted",
  "echo-observed",
  "reply-detected",
  "parsed",
  "accepted",
  "rendered",
]);

/** How many recent moves the ring buffer keeps. */
export const LATENCY_RING_SIZE = 20;

const STAGE_SET = new Set(LATENCY_STAGES);

/**
 * Records the first observation of `stage` on a plain timestamp map. Late
 * duplicate reports (a second payload carrying the same stage) can never
 * rewrite the original observation.
 *
 * @param {Record<string, number>} stages mutable stage → epoch-ms map.
 * @param {string} stage one of {@link LATENCY_STAGES}.
 * @param {number} [at] epoch milliseconds, default now.
 * @returns {boolean} true when the stage was recorded.
 */
export function markStage(stages, stage, at = Date.now()) {
  if (!STAGE_SET.has(stage) || typeof at !== "number" || !Number.isFinite(at)) return false;
  if (Object.hasOwn(stages, stage)) return false;
  stages[stage] = at;
  return true;
}

/**
 * @typedef {object} TimelineEntry
 * @property {string[]} stages every stage name, in canonical order.
 * @property {number[]} deltasMs ms elapsed since `queued`, per stage.
 * @property {number} totalMs rendered − queued.
 * @property {number|null} gapFromPreviousMs queued − previous rendered, null on the first move.
 */

/**
 * Validates the structural invariants of an entry: presence and ordering of
 * stages, and non-negative, finite, monotonic deltas. Timing thresholds are
 * deliberately NOT checked here — a slow machine is not a broken one.
 *
 * @param {unknown} entry
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateTimelineEntry(entry) {
  const problems = [];
  if (typeof entry !== "object" || entry === null) {
    return { ok: false, problems: ["entry is not an object"] };
  }
  const { stages, deltasMs, totalMs, gapFromPreviousMs } = /** @type {TimelineEntry} */ (entry);
  if (!Array.isArray(stages) || stages.length !== LATENCY_STAGES.length) {
    problems.push("missing stages");
  } else {
    for (let i = 0; i < LATENCY_STAGES.length; i += 1) {
      if (stages[i] !== LATENCY_STAGES[i]) {
        problems.push(`stage order broken at ${i}`);
        break;
      }
    }
  }
  if (!Array.isArray(deltasMs) || deltasMs.length !== LATENCY_STAGES.length) {
    problems.push("delta count mismatch");
  } else {
    for (let i = 0; i < deltasMs.length; i += 1) {
      const delta = deltasMs[i];
      if (!Number.isFinite(delta)) {
        problems.push(`stage ${LATENCY_STAGES[i] || i} is NaN or infinite`);
        break;
      }
      if (delta < 0) {
        problems.push(`stage ${LATENCY_STAGES[i] || i} is negative`);
        break;
      }
      if (i > 0 && delta < deltasMs[i - 1]) {
        problems.push(`stage ${LATENCY_STAGES[i] || i} is out of order`);
        break;
      }
    }
  }
  if (!Number.isFinite(totalMs) || totalMs < 0) problems.push("total is negative or NaN");
  if (gapFromPreviousMs !== null && (!Number.isFinite(gapFromPreviousMs) || gapFromPreviousMs < 0)) {
    problems.push("gap is negative or NaN");
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Ring buffer of recent send round-trips. One instance lives in the panel.
 */
export class LatencyTimeline {
  /** @type {TimelineEntry[]} */
  #entries = [];
  /** @type {{stages: Map<string, number>, gap: number|null}|null} */
  #current = null;
  /** @type {() => number} */
  #clock;
  /** @type {number|null} */
  #lastRenderedAt = null;

  /**
   * @param {object} [options]
   * @param {() => number} [options.clock] epoch-ms source (injectable for tests).
   */
  constructor({ clock = () => Date.now() } = {}) {
    this.#clock = clock;
  }

  /**
   * Starts a new entry at the `queued` stage. Any previously unfinished entry
   * is dropped — only completed moves are recorded.
   */
  begin() {
    this.#current = { stages: new Map(), gap: null };
    const at = this.#clock();
    this.#current.stages.set("queued", at);
    if (this.#lastRenderedAt !== null) {
      this.#current.gap = Math.max(0, at - this.#lastRenderedAt);
    }
  }

  /**
   * Records one stage on the current entry. First observation wins.
   *
   * @param {string} stage one of {@link LATENCY_STAGES}.
   * @param {number} [at] epoch milliseconds.
   * @returns {boolean} true when recorded.
   */
  mark(stage, at = this.#clock()) {
    if (!this.#current || !STAGE_SET.has(stage)) return false;
    if (this.#current.stages.has(stage)) return false;
    if (typeof at !== "number" || !Number.isFinite(at)) return false;
    this.#current.stages.set(stage, at);
    return true;
  }

  /**
   * Merges content-script stage timestamps (submitted / echo-observed /
   * reply-detected) carried through message payloads. First observation wins.
   *
   * @param {Record<string, number>|null|undefined} stages
   */
  mergeExternal(stages) {
    if (!this.#current || typeof stages !== "object" || stages === null) return;
    for (const [stage, at] of Object.entries(stages)) {
      if (!this.#current.stages.has(stage)) this.mark(stage, at);
    }
  }

  /**
   * Completes the current entry. Incomplete entries are discarded: the ring
   * only ever holds fully staged accepted moves.
   *
   * @returns {TimelineEntry|null} the recorded entry, or null.
   */
  finish() {
    const current = this.#current;
    this.#current = null;
    if (!current) return null;
    const queuedAt = current.stages.get("queued");
    const deltasMs = [];
    for (const stage of LATENCY_STAGES) {
      const at = current.stages.get(stage);
      if (typeof at !== "number") return null; // missing stage — never recorded
      deltasMs.push(Math.max(0, at - queuedAt));
    }
    /** @type {TimelineEntry} */
    const entry = {
      stages: [...LATENCY_STAGES],
      deltasMs,
      totalMs: deltasMs[deltasMs.length - 1],
      gapFromPreviousMs: current.gap,
    };
    this.#lastRenderedAt = current.stages.get("rendered") ?? null;
    this.#entries.push(entry);
    while (this.#entries.length > LATENCY_RING_SIZE) this.#entries.shift();
    return entry;
  }

  /** Drops the in-flight entry (a send that never produced an accepted move). */
  abandon() {
    this.#current = null;
  }

  /** @returns {TimelineEntry[]} oldest first, at most {@link LATENCY_RING_SIZE}. */
  get entries() {
    return [...this.#entries];
  }
}

/**
 * Redacted, copy-safe export: stage names and numbers only.
 *
 * @param {ReadonlyArray<TimelineEntry>} entries
 * @returns {string} the report text.
 */
export function formatLatencyReport(entries) {
  const lines = ["AI Chess Companion — latency timeline (ms deltas, no content)"];
  if (!Array.isArray(entries) || entries.length === 0) {
    lines.push("(no recorded moves yet)");
    return lines.join("\n");
  }
  entries.forEach((entry, index) => {
    const parts = LATENCY_STAGES.map((stage, i) => `${stage}=${entry.deltasMs?.[i] ?? "-"}`);
    const gap =
      entry.gapFromPreviousMs === null || entry.gapFromPreviousMs === undefined ? "-" : entry.gapFromPreviousMs;
    lines.push(`move ${index + 1}: ${parts.join(" ")} total=${entry.totalMs} gap-prev-rendered=${gap}`);
  });
  return lines.join("\n");
}
