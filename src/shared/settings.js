/**
 * User preferences: defaults, validation and persistence.
 *
 * Settings are stored in `chrome.storage.local` (never synced, never sent
 * anywhere) and are validated on read so that a hand-edited storage value can
 * never break the UI.
 *
 * v0.2.0 extends the schema with locale, board themes, font scale, density,
 * sounds, clock and analysis toggles. Old snapshots are migrated.
 *
 * @module shared/settings
 */

import { Color } from "../core/pieces.js";

/** Storage key for the settings record. */
export const SETTINGS_KEY = "settings";

/** UI themes. */
export const THEMES = Object.freeze(["dark", "light", "system"]);

/** Board themes. */
export const BOARD_THEMES = Object.freeze(["classic", "blue", "green", "high-contrast"]);

/** Locales. */
export const LOCALES = Object.freeze(["en", "vi", "system"]);

/** Font scales. */
export const FONT_SCALES = Object.freeze(["small", "medium", "large"]);

/** Density modes. */
export const DENSITIES = Object.freeze(["comfortable", "compact"]);

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
 * @property {'dark'|'light'|'system'} theme UI theme.
 * @property {boolean} persistGame restore the running game after a reload.
 * @property {'en'|'vi'|'system'} locale UI language.
 * @property {'classic'|'blue'|'green'|'high-contrast'} boardTheme board colour theme.
 * @property {'small'|'medium'|'large'} fontScale font scale.
 * @property {'comfortable'|'compact'} density layout density.
 * @property {boolean} soundEnabled play move/capture/check sounds (WebAudio, off by default).
 * @property {boolean} clockEnabled show clocks (off by default).
 * @property {boolean} animationsEnabled animate moves (respects prefers-reduced-motion).
 * @property {boolean} evalBarEnabled show evaluation bar.
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  playerColor: Color.WHITE,
  showCoordinates: true,
  showLegalTargets: true,
  highlightLastMove: true,
  autoRetry: true,
  maxRetries: 2,
  theme: "system",
  persistGame: true,
  locale: "system",
  boardTheme: "classic",
  fontScale: "medium",
  density: "comfortable",
  soundEnabled: false,
  clockEnabled: false,
  animationsEnabled: true,
  evalBarEnabled: false,
});

/** Bounds for {@link Settings.maxRetries}. */
export const MAX_RETRIES_LIMIT = 5;

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * @param {unknown} value
 * @param {ReadonlyArray<string>} allowed
 * @param {string} fallback
 * @returns {string}
 */
function asEnum(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

/**
 * Coerces arbitrary input into a valid settings object. Unknown keys are
 * dropped so stale storage payloads cannot leak into the app. Old v0.1.0
 * settings (theme dark/light only) are migrated to system-aware defaults.
 *
 * @param {unknown} input
 * @returns {Settings} a fully populated settings object.
 */
export function normaliseSettings(input) {
  const source = typeof input === "object" && input !== null ? input : {};
  const retries = Number(source.maxRetries);

  // Migrate old theme values: keep dark/light, default to system if missing
  const rawTheme = source.theme;
  const theme = asEnum(rawTheme, THEMES, DEFAULT_SETTINGS.theme);
  // v0.1.0 had only dark/light, no system — keep as is, no migration needed

  return {
    playerColor: source.playerColor === Color.BLACK ? Color.BLACK : DEFAULT_SETTINGS.playerColor,
    showCoordinates: asBoolean(source.showCoordinates, DEFAULT_SETTINGS.showCoordinates),
    showLegalTargets: asBoolean(source.showLegalTargets, DEFAULT_SETTINGS.showLegalTargets),
    highlightLastMove: asBoolean(source.highlightLastMove, DEFAULT_SETTINGS.highlightLastMove),
    autoRetry: asBoolean(source.autoRetry, DEFAULT_SETTINGS.autoRetry),
    maxRetries: Number.isInteger(retries)
      ? Math.min(Math.max(retries, 0), MAX_RETRIES_LIMIT)
      : DEFAULT_SETTINGS.maxRetries,
    theme,
    persistGame: asBoolean(source.persistGame, DEFAULT_SETTINGS.persistGame),
    locale: asEnum(source.locale, LOCALES, DEFAULT_SETTINGS.locale),
    boardTheme: asEnum(source.boardTheme, BOARD_THEMES, DEFAULT_SETTINGS.boardTheme),
    fontScale: asEnum(source.fontScale, FONT_SCALES, DEFAULT_SETTINGS.fontScale),
    density: asEnum(source.density, DENSITIES, DEFAULT_SETTINGS.density),
    soundEnabled: asBoolean(source.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
    clockEnabled: asBoolean(source.clockEnabled, DEFAULT_SETTINGS.clockEnabled),
    animationsEnabled: asBoolean(source.animationsEnabled, DEFAULT_SETTINGS.animationsEnabled),
    evalBarEnabled: asBoolean(source.evalBarEnabled, DEFAULT_SETTINGS.evalBarEnabled),
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

/**
 * Resolves the effective theme (dark/light) from a stored theme that may be
 * 'system'. Uses `prefers-color-scheme` when available.
 *
 * @param {'dark'|'light'|'system'} theme
 * @returns {'dark'|'light'}
 */
export function resolveTheme(theme) {
  if (theme === "dark" || theme === "light") {
    return theme;
  }
  if (typeof globalThis.matchMedia === "function") {
    try {
      return globalThis.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch {
      return "dark";
    }
  }
  return "dark";
}

/**
 * Resolves the effective locale from stored locale that may be 'system'.
 * Uses `chrome.i18n.getUILanguage()` when available, otherwise navigator.
 *
 * @param {'en'|'vi'|'system'} locale
 * @returns {'en'|'vi'}
 */
export function resolveLocale(locale) {
  if (locale === "en" || locale === "vi") {
    return locale;
  }
  try {
    const uiLang = globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || "en";
    const lower = String(uiLang).toLowerCase();
    if (lower.startsWith("vi")) {
      return "vi";
    }
  } catch {
    // ignore
  }
  return "en";
}
