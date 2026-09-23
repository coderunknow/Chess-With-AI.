/**
 * Local game library — schema v2 with migration from v0.1.0.
 *
 * Stored in chrome.storage.local under GAME_LIBRARY_KEY.
 * Handles: list, open, rename, duplicate, delete with undo, title/date/result/color,
 * final position, resumable in-progress game.
 *
 * Quota-aware, corrupt records discarded without losing rest.
 * Pure except for storage wrapper.
 *
 * @module shared/game-library
 */

import { START_FEN } from "../core/fen.js";
import { createLogger } from "./log.js";
import { readValue, writeValue } from "./storage.js";

const log = createLogger("game-library");

/** Storage key for library */
export const GAME_LIBRARY_KEY = "gameLibrary";

/** Storage key for last deleted game (undo) */
export const LAST_DELETED_KEY = "lastDeletedGame";

/** Schema version */
export const LIBRARY_VERSION = 2;

/** Max games to keep (LRU) */
export const MAX_GAMES = 50;

/**
 * @typedef {object} LibraryGame
 * @property {string} id unique id
 * @property {string} title
 * @property {string} date ISO date
 * @property {string} initialFen
 * @property {string[]} moves UCI moves
 * @property {string} result PGN result token
 * @property {'w'|'b'} playerColor
 * @property {string} finalFen
 * @property {number} createdAt timestamp
 * @property {number} updatedAt timestamp
 */

/**
 * @typedef {object} GameLibrary
 * @property {number} version
 * @property {LibraryGame[]} games
 */

/**
 * Creates empty library.
 *
 * @returns {GameLibrary}
 */
export function createEmptyLibrary() {
  return { version: LIBRARY_VERSION, games: [] };
}

/**
 * Generates a unique id.
 *
 * @returns {string}
 */
export function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validates a library game record, returns null if corrupt.
 *
 * @param {unknown} input
 * @returns {LibraryGame|null}
 */
export function validateGame(input) {
  if (typeof input !== "object" || input === null) return null;
  const obj = /** @type {any} */ (input);
  if (typeof obj.id !== "string" || obj.id.length === 0) return null;
  if (typeof obj.title !== "string") return null;
  if (typeof obj.initialFen !== "string") return null;
  if (!Array.isArray(obj.moves)) return null;
  if (typeof obj.result !== "string") return null;
  if (obj.playerColor !== "w" && obj.playerColor !== "b") return null;
  if (typeof obj.finalFen !== "string") return null;

  // Bound checks
  if (obj.title.length > 200) obj.title = obj.title.slice(0, 200);
  if (obj.moves.length > 500) return null; // too long, likely corrupt
  for (const move of obj.moves) {
    if (typeof move !== "string" || move.length > 10) return null;
  }

  return {
    id: obj.id,
    title: obj.title || "Untitled game",
    date: typeof obj.date === "string" ? obj.date : new Date().toISOString().slice(0, 10),
    initialFen: obj.initialFen,
    moves: obj.moves,
    result: obj.result,
    playerColor: obj.playerColor,
    finalFen: obj.finalFen,
    createdAt: typeof obj.createdAt === "number" ? obj.createdAt : Date.now(),
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : Date.now(),
  };
}

/**
 * Normalizes library, discarding corrupt records.
 *
 * @param {unknown} input
 * @returns {GameLibrary}
 */
export function normaliseLibrary(input) {
  if (typeof input !== "object" || input === null) {
    return createEmptyLibrary();
  }
  const obj = /** @type {any} */ (input);
  const version = obj.version;

  // Migration from v1 (which was just a single game snapshot)
  if (version === 1 || (obj.initialFen && obj.moves)) {
    // Old single game snapshot format
    log.info("migrating library from v1 snapshot");
    const singleGame = {
      id: generateId(),
      title: "Migrated game",
      date: new Date().toISOString().slice(0, 10),
      initialFen: obj.initialFen || START_FEN,
      moves: Array.isArray(obj.moves) ? obj.moves : [],
      result: obj.result || "*",
      playerColor: obj.playerColor === "b" ? "b" : "w",
      finalFen: obj.finalFen || obj.initialFen || START_FEN,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const validated = validateGame(singleGame);
    return { version: LIBRARY_VERSION, games: validated ? [validated] : [] };
  }

  if (version !== LIBRARY_VERSION) {
    // If version missing or old, try to recover games array
    if (Array.isArray(obj.games)) {
      const games = obj.games.map(validateGame).filter(Boolean);
      return { version: LIBRARY_VERSION, games };
    }
    return createEmptyLibrary();
  }

  if (!Array.isArray(obj.games)) {
    return createEmptyLibrary();
  }

  const games = [];
  for (const raw of obj.games) {
    const validated = validateGame(raw);
    if (validated) {
      games.push(validated);
    } else {
      log.warn("discarding corrupt game record", raw);
    }
  }

  // Sort by updatedAt descending
  games.sort((a, b) => b.updatedAt - a.updatedAt);

  // Enforce LRU limit
  const trimmed = games.slice(0, MAX_GAMES);

  return { version: LIBRARY_VERSION, games: trimmed };
}

/**
 * Reads library from storage.
 *
 * @returns {Promise<GameLibrary>}
 */
export async function readLibrary() {
  const raw = await readValue(GAME_LIBRARY_KEY, null);
  return normaliseLibrary(raw);
}

/**
 * Writes library to storage, quota-aware.
 *
 * @param {GameLibrary} library
 * @returns {Promise<boolean>} true if written
 */
export async function writeLibrary(library) {
  const normalised = normaliseLibrary(library);
  // Ensure LRU
  if (normalised.games.length > MAX_GAMES) {
    normalised.games = normalised.games.slice(0, MAX_GAMES);
  }

  try {
    const ok = await writeValue(GAME_LIBRARY_KEY, normalised);
    if (!ok) {
      log.warn("failed to write library, storage may be full");
      return false;
    }
    return true;
  } catch (error) {
    log.warn("quota error writing library", error);
    // Try to free space by removing oldest half
    try {
      const trimmed = { ...normalised, games: normalised.games.slice(0, Math.floor(MAX_GAMES / 2)) };
      const ok = await writeValue(GAME_LIBRARY_KEY, trimmed);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Adds a game to library.
 *
 * @param {GameLibrary} library
 * @param {LibraryGame} game
 * @returns {GameLibrary}
 */
export function addGame(library, game) {
  const validated = validateGame(game);
  if (!validated) throw new Error("Invalid game");
  const games = [validated, ...library.games.filter((g) => g.id !== validated.id)];
  const trimmed = games.slice(0, MAX_GAMES);
  return { version: LIBRARY_VERSION, games: trimmed };
}

/**
 * Updates a game.
 *
 * @param {GameLibrary} library
 * @param {string} id
 * @param {Partial<LibraryGame>} patch
 * @returns {GameLibrary}
 */
export function updateGame(library, id, patch) {
  const games = library.games.map((game) => {
    if (game.id !== id) return game;
    const updated = { ...game, ...patch, updatedAt: Date.now() };
    return validateGame(updated) || game;
  });
  return { version: LIBRARY_VERSION, games };
}

/**
 * Deletes a game, returns new library and deleted game for undo.
 *
 * @param {GameLibrary} library
 * @param {string} id
 * @returns {{library:GameLibrary, deleted:LibraryGame|null}}
 */
export function deleteGame(library, id) {
  const deleted = library.games.find((g) => g.id === id) || null;
  const games = library.games.filter((g) => g.id !== id);
  return { library: { version: LIBRARY_VERSION, games }, deleted };
}

/**
 * Duplicates a game.
 *
 * @param {GameLibrary} library
 * @param {string} id
 * @returns {GameLibrary}
 */
export function duplicateGame(library, id) {
  const original = library.games.find((g) => g.id === id);
  if (!original) return library;
  const copy = {
    ...original,
    id: generateId(),
    title: `${original.title} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return addGame(library, copy);
}

/**
 * Creates a LibraryGame from a session snapshot.
 *
 * @param {object} snapshot from GameSession.snapshot()
 * @param {object} [options]
 * @param {string} [options.title]
 * @returns {LibraryGame}
 */
export function gameFromSnapshot(snapshot, { title = "" } = {}) {
  const now = Date.now();
  return {
    id: generateId(),
    title: title || `Game ${new Date().toISOString().slice(0, 10)}`,
    date: new Date().toISOString().slice(0, 10),
    initialFen: snapshot.initialFen || START_FEN,
    moves: snapshot.moves || [],
    result: snapshot.result || "*",
    playerColor: snapshot.playerColor || "w",
    finalFen: snapshot.finalFen || snapshot.initialFen || START_FEN,
    createdAt: now,
    updatedAt: now,
  };
}
