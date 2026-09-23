/**
 * Zobrist hashing for chess positions.
 *
 * Provides deterministic random keys for pieces on squares, castling rights,
 * en-passant file and side to move. Used by the search transposition table.
 *
 * Pure, no DOM, no chrome.*.
 *
 * @module core/zobrist
 */

// Simple deterministic PRNG (xorshift) for reproducibility
function xorshift64(seed) {
  let x = BigInt(seed);
  return () => {
    x ^= x << 13n;
    x ^= x >> 7n;
    x ^= x << 17n;
    return x & ((1n << 64n) - 1n);
  };
}

const rng = xorshift64(0x9e3779b97f4a7c15n);

function random64() {
  // Combine two 32-bit halves
  const hi = rng();
  return hi;
}

/** Piece keys: [pieceIndex][square] -> bigint */
const PIECE_KEYS = (() => {
  const pieces = ["P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];
  const table = {};
  for (const piece of pieces) {
    table[piece] = new Array(64);
    for (let sq = 0; sq < 64; sq += 1) {
      table[piece][sq] = random64();
    }
  }
  return Object.freeze(table);
})();

const CASTLING_KEYS = (() => {
  const keys = new Array(16);
  for (let i = 0; i < 16; i += 1) {
    keys[i] = random64();
  }
  return Object.freeze(keys);
})();

const EN_PASSANT_KEYS = (() => {
  const keys = new Array(8);
  for (let i = 0; i < 8; i += 1) {
    keys[i] = random64();
  }
  return Object.freeze(keys);
})();

const TURN_KEY = random64();

/**
 * Computes Zobrist key for a position state.
 *
 * @param {import('./fen.js').PositionState} state
 * @returns {bigint} 64-bit key
 */
export function computeZobristKey(state) {
  let key = 0n;
  for (let sq = 0; sq < 64; sq += 1) {
    const piece = state.board[sq];
    if (piece) {
      key ^= PIECE_KEYS[piece][sq];
    }
  }
  key ^= CASTLING_KEYS[state.castling];
  if (state.enPassant !== -1) {
    // Only file matters for Zobrist (common optimization)
    const file = state.enPassant & 7;
    key ^= EN_PASSANT_KEYS[file];
  }
  if (state.turn === "b") {
    key ^= TURN_KEY;
  }
  return key;
}

/**
 * Updates a key incrementally for a move (for future use, not required for v0.2.0
 * but provided for completeness).
 *
 * @param {bigint} key current key
 * @param {object} update
 * @param {string} [update.movedPiece]
 * @param {number} [update.from]
 * @param {number} [update.to]
 * @param {string} [update.captured]
 * @param {number} [update.capturedSquare]
 * @param {number} [update.oldCastling]
 * @param {number} [update.newCastling]
 * @param {number} [update.oldEnPassant]
 * @param {number} [update.newEnPassant]
 * @param {boolean} [update.turnChanged]
 * @returns {bigint} new key
 */
export function updateZobristKey(key, update) {
  let newKey = key;
  if (update.movedPiece && update.from !== undefined && update.to !== undefined) {
    newKey ^= PIECE_KEYS[update.movedPiece][update.from];
    newKey ^= PIECE_KEYS[update.movedPiece][update.to];
  }
  if (update.captured && update.capturedSquare !== undefined) {
    newKey ^= PIECE_KEYS[update.captured][update.capturedSquare];
  }
  if (update.oldCastling !== undefined && update.newCastling !== undefined) {
    newKey ^= CASTLING_KEYS[update.oldCastling];
    newKey ^= CASTLING_KEYS[update.newCastling];
  }
  if (update.oldEnPassant !== undefined && update.oldEnPassant !== -1) {
    newKey ^= EN_PASSANT_KEYS[update.oldEnPassant & 7];
  }
  if (update.newEnPassant !== undefined && update.newEnPassant !== -1) {
    newKey ^= EN_PASSANT_KEYS[update.newEnPassant & 7];
  }
  if (update.turnChanged) {
    newKey ^= TURN_KEY;
  }
  return newKey;
}

export { PIECE_KEYS, CASTLING_KEYS, EN_PASSANT_KEYS, TURN_KEY };
