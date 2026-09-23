/**
 * Optional chess clocks — counts both sides, off by default.
 *
 * Pure, DOM-free. The UI layer renders it.
 *
 * @module shared/clock
 */

/**
 * @typedef {object} ClockState
 * @property {number} whiteMs remaining ms for white
 * @property {number} blackMs remaining ms for black
 * @property {'w'|'b'|null} running which side is ticking, null if paused
 * @property {number} lastTick timestamp of last tick
 */

export const DEFAULT_TIME_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @param {number} [initialMs]
 * @returns {ClockState}
 */
export function createClock(initialMs = DEFAULT_TIME_MS) {
  return {
    whiteMs: initialMs,
    blackMs: initialMs,
    running: null,
    lastTick: 0,
  };
}

/**
 * Starts clock for side to move.
 *
 * @param {ClockState} clock
 * @param {'w'|'b'} turn
 * @returns {ClockState}
 */
export function startClock(clock, turn) {
  const now = Date.now();
  return { ...clock, running: turn, lastTick: now };
}

/**
 * Stops clock.
 *
 * @param {ClockState} clock
 * @returns {ClockState}
 */
export function stopClock(clock) {
  if (!clock.running) return clock;
  const now = Date.now();
  const elapsed = now - clock.lastTick;
  const updated = { ...clock };
  if (clock.running === "w") {
    updated.whiteMs = Math.max(0, clock.whiteMs - elapsed);
  } else {
    updated.blackMs = Math.max(0, clock.blackMs - elapsed);
  }
  updated.running = null;
  updated.lastTick = 0;
  return updated;
}

/**
 * Ticks clock, updating remaining time.
 *
 * @param {ClockState} clock
 * @returns {ClockState}
 */
export function tickClock(clock) {
  if (!clock.running) return clock;
  const now = Date.now();
  const elapsed = now - clock.lastTick;
  if (elapsed < 100) return clock; // throttle
  const updated = { ...clock, lastTick: now };
  if (clock.running === "w") {
    updated.whiteMs = Math.max(0, clock.whiteMs - elapsed);
  } else {
    updated.blackMs = Math.max(0, clock.blackMs - elapsed);
  }
  return updated;
}

/**
 * Formats ms to mm:ss.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * @param {ClockState} clock
 * @returns {boolean} true when either side flagged
 */
export function isFlagged(clock) {
  return clock.whiteMs <= 0 || clock.blackMs <= 0;
}
