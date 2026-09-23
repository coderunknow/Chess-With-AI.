/**
 * Minimal namespaced logger.
 *
 * All extension logging goes through here so that messages are consistent and
 * easy to filter in DevTools (`AI Chess Companion:content`). Nothing is sent
 * anywhere; this is console output only.
 *
 * @module shared/log
 */

import { APP_NAME } from "./meta.js";

/** Log levels that can be silenced with {@link setLogLevel}. */
export const LOG_LEVEL = Object.freeze({ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 4 });

let currentLevel = LOG_LEVEL.INFO;

/**
 * @param {number} level one of {@link LOG_LEVEL}.
 */
export function setLogLevel(level) {
  if (Number.isInteger(level) && level >= LOG_LEVEL.DEBUG && level <= LOG_LEVEL.SILENT) {
    currentLevel = level;
  }
}

/**
 * @typedef {object} Logger
 * @property {(...args: unknown[]) => void} debug
 * @property {(...args: unknown[]) => void} info
 * @property {(...args: unknown[]) => void} warn
 * @property {(...args: unknown[]) => void} error
 */

/**
 * @param {string} scope short subsystem name, e.g. `content`.
 * @returns {Logger} a logger that prefixes every message with the app name.
 */
export function createLogger(scope) {
  const prefix = `${APP_NAME}:${scope}`;

  /**
   * @param {number} level
   * @param {'debug'|'info'|'warn'|'error'} method
   * @returns {(...args: unknown[]) => void}
   */
  const emit =
    (level, method) =>
    (...args) => {
      if (level < currentLevel) {
        return;
      }
      const target = globalThis.console;
      if (!target || typeof target[method] !== "function") {
        return;
      }
      target[method](`[${prefix}]`, ...args);
    };

  return {
    debug: emit(LOG_LEVEL.DEBUG, "debug"),
    info: emit(LOG_LEVEL.INFO, "info"),
    warn: emit(LOG_LEVEL.WARN, "warn"),
    error: emit(LOG_LEVEL.ERROR, "error"),
  };
}
