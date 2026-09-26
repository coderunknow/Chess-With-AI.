// @ts-check
/**
 * Authoritative panel modes. Mode-owned state must never outlive its mode.
 *
 * @module ui/modes
 */

/** @typedef {"PLAY"|"RATED"|"BATTLE"|"BOT_VS_AI"} ModeId */

export const Mode = Object.freeze({
  PLAY: "PLAY",
  RATED: "RATED",
  BATTLE: "BATTLE",
  BOT_VS_AI: "BOT_VS_AI",
});

/** @type {ReadonlyArray<ModeId>} */
export const MODES = Object.freeze(Object.values(Mode));

/**
 * Conservative transition table. Every specialised mode returns to ordinary
 * play; starting another mode is explicit and therefore goes through PLAY.
 *
 * @type {Readonly<Record<ModeId, ReadonlyArray<ModeId>>>}
 */
export const MODE_TRANSITIONS = Object.freeze({
  PLAY: Object.freeze(["PLAY", "RATED", "BATTLE", "BOT_VS_AI"]),
  RATED: Object.freeze(["PLAY"]),
  BATTLE: Object.freeze(["PLAY"]),
  BOT_VS_AI: Object.freeze(["PLAY"]),
});

/**
 * @param {unknown} from
 * @param {unknown} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return (
    MODES.includes(/** @type {ModeId} */ (from)) &&
    MODE_TRANSITIONS[/** @type {ModeId} */ (from)].includes(/** @type {ModeId} */ (to))
  );
}

/**
 * @param {ModeId} from
 * @param {ModeId} to
 * @returns {ModeId}
 */
export function transitionMode(from, to) {
  if (!canTransition(from, to)) throw new Error(`Invalid mode transition: ${from} -> ${to}`);
  return to;
}

/**
 * Derive the authoritative mode from the live App-owned fields. Prefer this
 * over a second parallel state field so the existing #match / #battleState
 * ownership stays the single source of truth.
 *
 * @param {{match?: unknown, battleState?: unknown, botState?: unknown}} state
 * @returns {ModeId}
 */
export function deriveMode(state) {
  if (state?.botState != null) return Mode.BOT_VS_AI;
  if (state?.battleState != null) return Mode.BATTLE;
  if (state?.match != null) return Mode.RATED;
  return Mode.PLAY;
}
