/**
 * Thin, promise-based wrapper around `chrome.storage.local`.
 *
 * The extension never talks to a network service, so local storage is only used
 * for two things: user preferences and the in-progress game. Every helper
 * degrades gracefully when the API is unavailable (for example in unit tests).
 *
 * @module shared/storage
 */

import { createLogger } from "./log.js";

const log = createLogger("storage");

/**
 * @returns {chrome.storage.StorageArea|null} the local storage area, if available.
 */
function area() {
  return globalThis.chrome?.storage?.local ?? null;
}

/**
 * @param {string} key
 * @param {unknown} [fallback] value returned when the key is missing or unreadable.
 * @returns {Promise<unknown>} the stored value.
 */
export async function readValue(key, fallback = null) {
  const storage = area();
  if (!storage) {
    return fallback;
  }
  try {
    const result = await storage.get(key);
    return Object.hasOwn(result, key) ? result[key] : fallback;
  } catch (error) {
    log.warn(`could not read "${key}"`, error);
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value value to store.
 * @returns {Promise<boolean>} true when the write succeeded.
 */
export async function writeValue(key, value) {
  const storage = area();
  if (!storage) {
    return false;
  }
  try {
    await storage.set({ [key]: value });
    return true;
  } catch (error) {
    log.warn(`could not write "${key}"`, error);
    return false;
  }
}

/**
 * @param {string} key
 * @returns {Promise<boolean>} true when the key was removed.
 */
export async function removeValue(key) {
  const storage = area();
  if (!storage) {
    return false;
  }
  try {
    await storage.remove(key);
    return true;
  } catch (error) {
    log.warn(`could not remove "${key}"`, error);
    return false;
  }
}
