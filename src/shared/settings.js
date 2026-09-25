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
import { DEFAULT_TIME_MS } from "./clock.js";

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

/** How the AI is asked for moves. Only the reply style differs — the game state and move-selection logic are identical. */
export const PROMPT_STYLES = Object.freeze({
  STANDARD: "standard",
  CONCISE: "concise",
  /** Minimal output: the move only, no commentary. */
  EFFICIENT: "efficient",
  /** The move first, then 1–2 short witty sentences (slider-controlled). */
  FUN: "fun",
});

/** Allowed prompt-style values. */
export const PROMPT_STYLE_VALUES = Object.freeze(Object.values(PROMPT_STYLES));

/** Fun-mode commentary length bounds (sentences). */
export const FUN_SENTENCES_MIN = 1;
export const FUN_SENTENCES_MAX = 2;

/** Battle clock bounds (local-only, never synced). */
export const BATTLE_MINUTES_MIN = 1;
export const BATTLE_MINUTES_MAX = 60;
export const BATTLE_INCREMENT_CHOICES = Object.freeze([0, 2, 3, 5]);
export const BATTLE_MAX_PLIES_MIN = 20;
export const BATTLE_MAX_PLIES_MAX = 500;

/** Interface detail levels: visibility of technical explanations only. */
export const INTERFACE_DETAILS = Object.freeze(["simple", "advanced"]);

/** Board orientation choices. */
export const BOARD_ORIENTATIONS = Object.freeze(["follow-side", "white", "black"]);

/** On-screen move-list formats (PGN always stays SAN). */
export const MOVE_LIST_FORMATS = Object.freeze(["san", "uci"]);

/** Pointer move-interaction modes; keyboard operation is unaffected. */
export const MOVE_INTERACTIONS = Object.freeze(["tap-drag", "tap", "drag"]);

/** Bounded "still waiting" reminder delays; 0 disables the reminder. */
export const WAITING_REMINDER_CHOICES = Object.freeze([0, 30000, 60000, 120000]);

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
 * @property {number} engineLevel local heuristic strength 1–8 (never an Elo).
 * @property {number} soundVolume WebAudio volume 0–1.
 * @property {number} clockDurationMs initial time on each clock.
 * @property {'auto'|'manual'} sendMode one-shot automatic send or copy/paste.
 * @property {number} generationWaitMs wait for Stop to disappear (ms).
 * @property {boolean} paused soft pause, persisted across service-worker restarts.
 * @property {number} matchAnchorElo requested Stockfish UCI_Elo; clamped again to the binary range.
 * @property {number} matchMoveTimeMs Stockfish go movetime, 100–5000ms.
 * @property {'simple'|'advanced'} interfaceDetail visibility of technical details (never of recovery actions).
 * @property {'follow-side'|'white'|'black'} boardOrientation which side sits at the bottom.
 * @property {'san'|'uci'} moveListFormat on-screen history format; PGN remains SAN.
 * @property {'tap-drag'|'tap'|'drag'} moveInteraction pointer gesture style; keyboard always works.
 * @property {boolean} confirmDestructive ask before replacing an ongoing game or switching sides.
 * @property {0|30000|60000|120000} waitingReminderMs quiet "still waiting" notice; never resends.
 * @property {'standard'|'concise'|'efficient'|'fun'} promptStyle response/output style of the chat prompt.
 * @property {number} funCommentarySentences fun-mode commentary length (1–2 sentences, slider).
 * @property {number} battleMinutesPerSide AI-battle clock, minutes per side (1–60).
 * @property {0|2|3|5} battleIncrementSec AI-battle increment in seconds.
 * @property {number} battleMaxPlies plies at which an AI battle is adjudicated a draw.
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
  engineLevel: 4,
  soundVolume: 0.4,
  clockDurationMs: DEFAULT_TIME_MS,
  sendMode: "auto",
  generationWaitMs: 120000,
  paused: false,
  matchAnchorElo: 1500,
  matchMoveTimeMs: 500,
  interfaceDetail: "simple",
  boardOrientation: "follow-side",
  moveListFormat: "san",
  moveInteraction: "tap-drag",
  confirmDestructive: true,
  waitingReminderMs: 0,
  promptStyle: PROMPT_STYLES.STANDARD,
  funCommentarySentences: 2,
  battleMinutesPerSide: 5,
  battleIncrementSec: 0,
  battleMaxPlies: 200,
});

/** Bounds for {@link Settings.maxRetries}. */
export const MAX_RETRIES_LIMIT = 5;

function boundedNumber(value, fallback, min, max, integer = true) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(min, Math.min(max, integer ? Math.round(num) : num)) : fallback;
}

/** Like boundedNumber, but null/empty mean "unset" — fall back instead of clamping to the minimum. */
function boundedNumberOrDefault(value, fallback, min, max, integer = true) {
  if (value === null || value === undefined || value === "") return fallback;
  return boundedNumber(value, fallback, min, max, integer);
}

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
    engineLevel: boundedNumber(source.engineLevel, DEFAULT_SETTINGS.engineLevel, 1, 8),
    soundVolume: boundedNumber(source.soundVolume, DEFAULT_SETTINGS.soundVolume, 0, 1, false),
    clockDurationMs: boundedNumber(source.clockDurationMs, DEFAULT_SETTINGS.clockDurationMs, 60000, 3600000),
    sendMode: asEnum(source.sendMode, ["auto", "manual"], DEFAULT_SETTINGS.sendMode),
    generationWaitMs: boundedNumber(source.generationWaitMs, DEFAULT_SETTINGS.generationWaitMs, 5000, 180000),
    paused: asBoolean(source.paused, DEFAULT_SETTINGS.paused),
    matchAnchorElo: boundedNumber(source.matchAnchorElo, DEFAULT_SETTINGS.matchAnchorElo, 0, 5000),
    matchMoveTimeMs: boundedNumber(source.matchMoveTimeMs, DEFAULT_SETTINGS.matchMoveTimeMs, 100, 5000),
    interfaceDetail: asEnum(source.interfaceDetail, INTERFACE_DETAILS, DEFAULT_SETTINGS.interfaceDetail),
    boardOrientation: asEnum(source.boardOrientation, BOARD_ORIENTATIONS, DEFAULT_SETTINGS.boardOrientation),
    moveListFormat: asEnum(source.moveListFormat, MOVE_LIST_FORMATS, DEFAULT_SETTINGS.moveListFormat),
    moveInteraction: asEnum(source.moveInteraction, MOVE_INTERACTIONS, DEFAULT_SETTINGS.moveInteraction),
    confirmDestructive: asBoolean(source.confirmDestructive, DEFAULT_SETTINGS.confirmDestructive),
    waitingReminderMs: WAITING_REMINDER_CHOICES.includes(Number(source.waitingReminderMs))
      ? Number(source.waitingReminderMs)
      : DEFAULT_SETTINGS.waitingReminderMs,
    promptStyle: asEnum(source.promptStyle, PROMPT_STYLE_VALUES, DEFAULT_SETTINGS.promptStyle),
    funCommentarySentences: boundedNumberOrDefault(
      source.funCommentarySentences,
      DEFAULT_SETTINGS.funCommentarySentences,
      FUN_SENTENCES_MIN,
      FUN_SENTENCES_MAX,
    ),
    battleMinutesPerSide: boundedNumberOrDefault(
      source.battleMinutesPerSide,
      DEFAULT_SETTINGS.battleMinutesPerSide,
      BATTLE_MINUTES_MIN,
      BATTLE_MINUTES_MAX,
    ),
    battleIncrementSec: BATTLE_INCREMENT_CHOICES.includes(Number(source.battleIncrementSec))
      ? Number(source.battleIncrementSec)
      : DEFAULT_SETTINGS.battleIncrementSec,
    battleMaxPlies: boundedNumberOrDefault(
      source.battleMaxPlies,
      DEFAULT_SETTINGS.battleMaxPlies,
      BATTLE_MAX_PLIES_MIN,
      BATTLE_MAX_PLIES_MAX,
    ),
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
