/**
 * User preferences: defaults, validation and persistence.
 *
 * Settings are stored in `chrome.storage.local` (never synced, never sent
 * anywhere) and are validated on read so that a hand-edited storage value can
 * never break the UI.
 *
 * @module shared/settings
 */

import { Color } from "../core/pieces.js";

/** Storage key for the settings record. */
export const SETTINGS_KEY = "settings";

/** Board colour themes. */
export const THEMES = Object.freeze(["dark", "light"]);

/** How the AI is asked for moves. */
export const PROMPT_STYLES = Object.freeze({
  STANDARD: "standard",
  CONCISE: "concise",
});

/**
 * @typedef {object} Settings
 * @property {'w'|'b'} playerColor side the human plays in a new game.
 * @property {boolean} showCoordinates render file/rank labels.
 * @property {boolean} showLegalTargets highlight legal destinations.
 * @property {boolean} highlightLastMove mark the previous move.
 * @property {boolean} autoRetry ask the AI again when it answers an illegal move.
 * @property {number} maxRetries how many automatic retries are allowed per move.
 * @property {'dark'|'light'} theme board theme.
 * @property {boolean} persistGame restore the running game after a reload.
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  playerColor: Color.WHITE,
  showCoordinates: true,
  showLegalTargets: true,
  highlightLastMove: true,
  autoRetry: true,
  maxRetries: 2,
  theme: "dark",
  persistGame: true,
});

/** Bounds for {@link Settings.maxRetries}. */
export const MAX_RETRIES_LIMIT = 5;

/**
 * @param {unknown} value
 * @returns {boolean} true for `true` only.
 */
function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Coerces arbitrary input into a valid settings object. Unknown keys are
 * dropped so stale storage payloads cannot leak into the app.
 *
 * @param {unknown} input
 * @returns {Settings} a fully populated settings object.
 */
export function normaliseSettings(input) {
  const source = typeof input === "object" && input !== null ? input : {};
  const retries = Number(source.maxRetries);

  return {
    playerColor: source.playerColor === Color.BLACK ? Color.BLACK : DEFAULT_SETTINGS.playerColor,
    showCoordinates: asBoolean(source.showCoordinates, DEFAULT_SETTINGS.showCoordinates),
    showLegalTargets: asBoolean(source.showLegalTargets, DEFAULT_SETTINGS.showLegalTargets),
    highlightLastMove: asBoolean(source.highlightLastMove, DEFAULT_SETTINGS.highlightLastMove),
    autoRetry: asBoolean(source.autoRetry, DEFAULT_SETTINGS.autoRetry),
    maxRetries: Number.isInteger(retries)
      ? Math.min(Math.max(retries, 0), MAX_RETRIES_LIMIT)
      : DEFAULT_SETTINGS.maxRetries,
    theme: THEMES.includes(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
    persistGame: asBoolean(source.persistGame, DEFAULT_SETTINGS.persistGame),
  };
}

/**
 * @param {Partial<Settings>} patch
 * @param {Settings} [base]
 * @returns {Settings} `base` with `patch` applied and re-validated.
 */
export function mergeSettings(patch, base = DEFAULT_SETTINGS) {
  return normaliseSettings({ ...base, ...(patch || {}) });
}
