/**
 * Rated games and a bounded maximum-likelihood estimate on the Stockfish
 * UCI_Elo scale. This record is independent of game snapshots/the library.
 * Only completed games produced by the real match controller belong here.
 *
 * @module shared/matches
 */

import { readValue, writeValue } from "./storage.js";

export const MATCHES_KEY = "ratedMatches";
export const MATCHES_VERSION = 1;
export const MAX_MATCHES = 100;
export const MAX_MATCH_BYTES = 900000; // below chrome.storage.local's per-extension quota
export const SCALE_LABEL = "Stockfish UCI_Elo scale, not FIDE";

export function emptyMatches() {
  return { version: MATCHES_VERSION, games: [] };
}

const RESULTS = new Set(["1-0", "0-1", "1/2-1/2"]);

function validGame(game) {
  return (
    game &&
    typeof game.id === "string" &&
    Number.isInteger(game.anchorElo) &&
    game.aiColor in { w: true, b: true } &&
    RESULTS.has(game.result) &&
    typeof game.platformId === "string" &&
    typeof game.pgn === "string" &&
    game.pgn.length > 0 &&
    game.pgn.length < 40000 &&
    Number.isFinite(game.createdAt) &&
    Number.isInteger(game.stockfishMoves) &&
    game.stockfishMoves > 0 &&
    Number.isInteger(game.chatMoves) &&
    game.chatMoves > 0
  );
}

export function normaliseMatches(data) {
  if (!data || data.version !== MATCHES_VERSION || !Array.isArray(data.games)) return emptyMatches();
  return {
    version: MATCHES_VERSION,
    games: data.games
      .filter(validGame)
      .slice(-MAX_MATCHES)
      .map((game) => ({
        id: game.id.slice(0, 100),
        anchorElo: game.anchorElo,
        aiColor: game.aiColor,
        result: game.result,
        platformId: game.platformId.slice(0, 80),
        pgn: game.pgn,
        createdAt: game.createdAt,
        stockfishMoves: game.stockfishMoves,
        chatMoves: game.chatMoves,
      })),
  };
}

export async function readMatches() {
  return normaliseMatches(await readValue(MATCHES_KEY, null));
}

/**
 * Persists first, then returns the new book. On quota failure drops oldest
 * entries, never overwrites the board snapshot/library. If no write succeeds,
 * return null and refuse to publish an estimate for the unsaved game.
 */
export async function appendRatedMatch(book, game) {
  if (!validGame(game)) return null;
  const next = normaliseMatches({ version: MATCHES_VERSION, games: [...book.games, game] });
  while (next.games.length > 0) {
    if (JSON.stringify(next).length <= MAX_MATCH_BYTES && (await writeValue(MATCHES_KEY, next))) return next;
    next.games.shift();
  }
  return null;
}

/** Score from the chat AI's perspective. */
export function aiScore(game) {
  if (game.result === "1/2-1/2") return 0.5;
  return (game.result === "1-0") === (game.aiColor === "w") ? 1 : 0;
}

/** Logistic expected score against a known Stockfish UCI_Elo anchor. */
export function expectedScore(rating, anchor) {
  return 1 / (1 + Math.pow(10, (anchor - rating) / 400));
}

/**
 * Bounded MLE with a 95% profile-likelihood interval. A draw contributes
 * half a point to the (fractional) Bernoulli log-likelihood. The interval is
 * the set with 2*(max logL - logL(r)) <= chi-square(1, .95) = 3.8414588.
 * At all-win/all-loss boundaries the MLE and CI are ONE-SIDED, not a fake
 * smoothed rating. Only games at the selected anchor are pooled.
 *
 * @param {ReadonlyArray<object>} games all saved rated games
 * @param {number} anchor selected anchor
 * @param {{min:number,max:number}} range THIS Stockfish binary's UCI_Elo range
 */
export function estimateRating(games, anchor, range) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) return null;
  const selected = games.filter((g) => validGame(g) && g.anchorElo === anchor);
  if (!selected.length) return null;
  const wins = selected.filter((g) => aiScore(g) === 1).length;
  const draws = selected.filter((g) => aiScore(g) === 0.5).length;
  const losses = selected.length - wins - draws;
  const points = wins + draws / 2;
  const n = selected.length;
  const logL = (rating) => {
    const p = expectedScore(rating, anchor);
    return points * Math.log(p) + (n - points) * Math.log1p(-p);
  };
  const unbounded =
    points === 0 ? -Infinity : points === n ? Infinity : anchor + 400 * Math.log10(points / (n - points));
  const estimate = Math.max(range.min, Math.min(range.max, unbounded));
  const limit = logL(estimate) - 3.841458820694124 / 2;
  const bisect = (min, max, rising) => {
    let low = min;
    let high = max;
    for (let i = 0; i < 65; i += 1) {
      const mid = (low + high) / 2;
      if (logL(mid) >= limit === rising) high = mid;
      else low = mid;
    }
    return (low + high) / 2;
  };
  const lower = logL(range.min) >= limit ? range.min : bisect(range.min, estimate, true);
  const upper = logL(range.max) >= limit ? range.max : bisect(estimate, range.max, false);
  return {
    games: n,
    wins,
    draws,
    losses,
    estimate: Math.round(estimate),
    lower: Math.round(lower),
    upper: Math.round(upper),
    boundary: estimate === range.min || estimate === range.max,
    provisional: n < 8 || upper - lower > 200,
    anchor,
  };
}

/** Safe plain-text PGN export (never render PGN as markup). */
export function exportMatches(book) {
  return normaliseMatches(book)
    .games.map((game) => game.pgn)
    .join("\n\n");
}
