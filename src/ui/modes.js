// @ts-check
/** Authoritative panel modes. Mode-owned state must never outlive its mode. */
export const Mode = Object.freeze({ PLAY: "PLAY", RATED: "RATED", BATTLE: "BATTLE", BOT_VS_AI: "BOT_VS_AI" });
export const MODES = Object.freeze(Object.values(Mode));

/**
 * A conservative transition table. Every mode can return to ordinary play;
 * starting another mode is explicit and therefore goes through PLAY first.
 */
export const MODE_TRANSITIONS = Object.freeze({
  PLAY: Object.freeze(["PLAY", "RATED", "BATTLE", "BOT_VS_AI"]),
  RATED: Object.freeze(["PLAY"]),
  BATTLE: Object.freeze(["PLAY"]),
  BOT_VS_AI: Object.freeze(["PLAY"]),
});

export function canTransition(from, to) {
  return MODES.includes(from) && MODE_TRANSITIONS[from].includes(to);
}

export function transitionMode(from, to) {
  if (!canTransition(from, to)) throw new Error(`Invalid mode transition: ${from} -> ${to}`);
  return to;
}
