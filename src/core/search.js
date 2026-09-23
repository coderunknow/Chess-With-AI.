/**
 * Local chess search — iterative deepening alpha-beta with quiescence,
 * transposition table, MVV-LVA + killer/history ordering, node/time budgets.
 *
 * Runs in a Worker (see search-worker.js) so UI never freezes, cancellable,
 * results discarded when panel closes.
 *
 * Pure, DOM-free, zero dependencies. Keeps perft exact.
 *
 * @module core/search
 */

import { evaluate } from "./eval.js";
import { isCapture } from "./move.js";

const MATE_SCORE = 20000;
const INF = 30000;

const TT_SIZE = 1 << 18; // 256k entries

/**
 * @typedef {object} TTEntry
 * @property {bigint} key
 * @property {number} depth
 * @property {number} score
 * @property {number} flag 0=exact,1=lower,2=upper
 * @property {import('./move.js').Move|null} bestMove
 */

class TranspositionTable {
  constructor(size = TT_SIZE) {
    this.size = size;
    this.table = new Array(size);
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {bigint} key
   * @returns {TTEntry|null}
   */
  get(key) {
    const index = Number(key & BigInt(this.size - 1));
    const entry = this.table[index];
    if (entry && entry.key === key) {
      this.hits += 1;
      return entry;
    }
    this.misses += 1;
    return null;
  }

  /**
   * @param {bigint} key
   * @param {number} depth
   * @param {number} score
   * @param {number} flag
   * @param {import('./move.js').Move|null} bestMove
   */
  set(key, depth, score, flag, bestMove) {
    const index = Number(key & BigInt(this.size - 1));
    const existing = this.table[index];
    // Replace if deeper or empty
    if (!existing || depth >= existing.depth) {
      this.table[index] = { key, depth, score, flag, bestMove };
    }
  }

  clear() {
    this.table = new Array(this.size);
    this.hits = 0;
    this.misses = 0;
  }
}

// MVV-LVA: victim * 10 - attacker
const MVV_LVA_SCORES = {
  p: 1,
  n: 2,
  b: 3,
  r: 4,
  q: 5,
  k: 6,
};

function mvvLva(move, position) {
  const attacker = position.pieceAt(move.from);
  const victim = position.pieceAt(move.to);
  if (!victim) return 0;
  const victimVal = MVV_LVA_SCORES[victim.toLowerCase()] || 0;
  const attackerVal = MVV_LVA_SCORES[attacker.toLowerCase()] || 0;
  return victimVal * 10 - attackerVal;
}

/**
 * Searcher class — holds TT, killers, history, counters.
 */
export class Searcher {
  constructor() {
    this.tt = new TranspositionTable();
    this.killers = new Map(); // ply -> [move, move]
    this.history = new Map(); // move key -> score
    this.nodes = 0;
    this.stopped = false;
    this.startTime = 0;
    this.timeLimitMs = 0;
    this.nodeLimit = 0;
  }

  /**
   * @param {object} [options]
   * @param {number} [options.timeLimitMs] max time
   * @param {number} [options.nodeLimit] max nodes
   */
  configure({ timeLimitMs = 0, nodeLimit = 0 } = {}) {
    this.timeLimitMs = timeLimitMs;
    this.nodeLimit = nodeLimit;
  }

  stop() {
    this.stopped = true;
  }

  resetCounters() {
    this.nodes = 0;
    this.stopped = false;
    this.startTime = Date.now();
  }

  shouldStop() {
    if (this.stopped) return true;
    if (this.nodeLimit > 0 && this.nodes >= this.nodeLimit) return true;
    if (this.timeLimitMs > 0 && Date.now() - this.startTime >= this.timeLimitMs) return true;
    return false;
  }

  /**
   * @param {import('./position.js').Position} position
   * @param {number} depth
   * @returns {{move:import('./move.js').Move|null, score:number, nodes:number, depth:number}}
   */
  searchRoot(position, depth) {
    this.resetCounters();
    const result = this.alphaBeta(position, depth, -INF, INF, 0, true);
    return { move: result.bestMove, score: result.score, nodes: this.nodes, depth };
  }

  /**
   * Iterative deepening.
   *
   * @param {import('./position.js').Position} position
   * @param {object} options
   * @param {number} options.maxDepth
   * @param {number} [options.timeLimitMs]
   * @param {number} [options.nodeLimit]
   * @param {(info:{depth:number, score:number, move:import('./move.js').Move|null, nodes:number})=>void} [options.onInfo]
   * @returns {{move:import('./move.js').Move|null, score:number, nodes:number, depth:number}}
   */
  iterativeDeepening(position, { maxDepth, timeLimitMs = 2000, nodeLimit = 0, onInfo = null } = {}) {
    this.configure({ timeLimitMs, nodeLimit });
    this.resetCounters();
    this.tt.clear();
    this.killers.clear();
    this.history.clear();

    let best = { move: null, score: 0, nodes: 0, depth: 0 };

    for (let d = 1; d <= maxDepth; d += 1) {
      if (this.shouldStop()) break;
      const result = this.alphaBeta(position, d, -INF, INF, 0, true);
      if (this.stopped) break;
      if (result.bestMove) {
        best = { move: result.bestMove, score: result.score, nodes: this.nodes, depth: d };
        if (onInfo) {
          onInfo({ depth: d, score: result.score, move: result.bestMove, nodes: this.nodes });
        }
      }
      // Early exit if mate found
      if (Math.abs(result.score) >= MATE_SCORE - 100) {
        break;
      }
    }

    return best;
  }

  /**
   * Alpha-beta with transposition table and quiescence.
   *
   * @param {import('./position.js').Position} position
   * @param {number} depth
   * @param {number} alpha
   * @param {number} beta
   * @param {number} ply
   * @param {boolean} isRoot
   * @returns {{score:number, bestMove:import('./move.js').Move|null}}
   */
  alphaBeta(position, depth, alpha, beta, ply, _isRoot = false) {
    this.nodes += 1;

    if (this.shouldStop()) {
      return { score: 0, bestMove: null };
    }

    let alphaLocal = alpha;
    const betaLocal = beta;

    // Check TT — use position's string key hash to bigint
    const zobristKey = hashStringToBigInt(position.key());
    const ttEntry = this.tt.get(zobristKey);
    if (ttEntry && ttEntry.depth >= depth) {
      if (ttEntry.flag === 0) {
        return { score: ttEntry.score, bestMove: ttEntry.bestMove };
      }
      if (ttEntry.flag === 1 && ttEntry.score >= betaLocal) {
        return { score: ttEntry.score, bestMove: ttEntry.bestMove };
      }
      if (ttEntry.flag === 2 && ttEntry.score <= alphaLocal) {
        return { score: ttEntry.score, bestMove: ttEntry.bestMove };
      }
    }

    const outcome = position.outcome();
    if (outcome.over) {
      if (outcome.reason === "checkmate") {
        return { score: -MATE_SCORE + ply, bestMove: null };
      }
      return { score: 0, bestMove: null };
    }

    if (depth === 0) {
      return { score: this.quiescence(position, alphaLocal, betaLocal, ply, 5), bestMove: null };
    }

    const moves = position.legalMoves();
    if (moves.length === 0) {
      if (position.isCheck()) {
        return { score: -MATE_SCORE + ply, bestMove: null };
      }
      return { score: 0, bestMove: null };
    }

    // Move ordering
    const ordered = this.orderMoves(moves, position, ply, ttEntry?.bestMove);

    let bestScore = -INF;
    let bestMove = null;
    let flag = 2; // upper

    for (const move of ordered) {
      position.makeMove(move, { validate: false });
      const result = this.alphaBeta(position, depth - 1, -betaLocal, -alphaLocal, ply + 1, false);
      const score = -result.score;
      position.unmakeMove();

      if (this.shouldStop()) {
        return { score: bestScore, bestMove };
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }

      if (score > alphaLocal) {
        alphaLocal = score;
        flag = 0; // exact
        // Update killers/history
        if (!isCapture(move)) {
          this.updateKillers(ply, move);
          this.updateHistory(move, depth);
        }
      }

      if (alphaLocal >= betaLocal) {
        flag = 1; // lower
        // Killer for cutoffs
        if (!isCapture(move)) {
          this.updateKillers(ply, move);
        }
        break;
      }
    }

    this.tt.set(zobristKey, depth, bestScore, flag, bestMove);
    return { score: bestScore, bestMove };
  }

  /**
   * Quiescence search — only captures and checks.
   *
   * @param {import('./position.js').Position} position
   * @param {number} alpha
   * @param {number} beta
   * @param {number} ply
   * @param {number} depth
   * @returns {number}
   */
  quiescence(position, alpha, beta, ply, depth) {
    this.nodes += 1;

    if (this.shouldStop()) return 0;

    let alphaLocal = alpha;
    const betaLocal = beta;

    const standPat = this.evaluatePosition(position);
    if (depth === 0) {
      return standPat;
    }

    if (standPat >= betaLocal) {
      return betaLocal;
    }
    if (alphaLocal < standPat) {
      alphaLocal = standPat;
    }

    const moves = position.legalMoves().filter((m) => isCapture(m) || position.isCheck());
    // Order captures by MVV-LVA
    moves.sort((a, b) => mvvLva(b, position) - mvvLva(a, position));

    for (const move of moves) {
      position.makeMove(move, { validate: false });
      const score = -this.quiescence(position, -betaLocal, -alphaLocal, ply + 1, depth - 1);
      position.unmakeMove();

      if (score >= betaLocal) {
        return betaLocal;
      }
      if (score > alphaLocal) {
        alphaLocal = score;
      }
    }

    return alphaLocal;
  }

  /**
   * @param {import('./position.js').Position} position
   * @returns {number} score from side to move perspective
   */
  evaluatePosition(position) {
    const raw = evaluate(position);
    // Convert white perspective to side-to-move perspective
    return position.turn === "w" ? raw : -raw;
  }

  /**
   * @param {import('./move.js').Move[]} moves
   * @param {import('./position.js').Position} position
   * @param {number} ply
   * @param {import('./move.js').Move|null} ttMove
   * @returns {import('./move.js').Move[]}
   */
  orderMoves(moves, position, ply, ttMove) {
    const killers = this.killers.get(ply) || [];
    return [...moves].sort((a, b) => {
      const scoreA = this.scoreMove(a, position, ply, ttMove, killers);
      const scoreB = this.scoreMove(b, position, ply, ttMove, killers);
      return scoreB - scoreA;
    });
  }

  /**
   * @param {import('./move.js').Move} move
   * @param {import('./position.js').Position} position
   * @param {number} ply
   * @param {import('./move.js').Move|null} ttMove
   * @param {import('./move.js').Move[]} killers
   * @returns {number}
   */
  scoreMove(move, position, ply, ttMove, killers) {
    if (ttMove && move.from === ttMove.from && move.to === ttMove.to && move.promotion === ttMove.promotion) {
      return 100000;
    }
    if (isCapture(move)) {
      return 9000 + mvvLva(move, position);
    }
    if (killers.some((k) => k.from === move.from && k.to === move.to)) {
      return 8000;
    }
    const key = `${move.from}-${move.to}-${move.promotion}`;
    return this.history.get(key) || 0;
  }

  /**
   * @param {number} ply
   * @param {import('./move.js').Move} move
   */
  updateKillers(ply, move) {
    const existing = this.killers.get(ply) || [];
    if (!existing.some((m) => m.from === move.from && m.to === move.to)) {
      existing.unshift(move);
      if (existing.length > 2) existing.pop();
      this.killers.set(ply, existing);
    }
  }

  /**
   * @param {import('./move.js').Move} move
   * @param {number} depth
   */
  updateHistory(move, depth) {
    const key = `${move.from}-${move.to}-${move.promotion}`;
    const current = this.history.get(key) || 0;
    this.history.set(key, current + depth * depth);
  }
}

/**
 * Simple string hash to bigint for TT (fallback when zobrist not used).
 *
 * @param {string} str
 * @returns {bigint}
 */
function hashStringToBigInt(str) {
  let hash = 0n;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31n + BigInt(str.charCodeAt(i))) & ((1n << 64n) - 1n);
  }
  return hash;
}

/**
 * Determines best move with iterative deepening, with strength levels.
 *
 * Levels 1-8: depth + deliberate weakness at low levels.
 *
 * @param {import('./position.js').Position} position
 * @param {object} options
 * @param {number} [options.level] 1-8, default 4
 * @param {number} [options.maxDepth] override
 * @param {number} [options.timeLimitMs]
 * @param {number} [options.nodeLimit]
 * @param {function} [options.onInfo]
 * @returns {{move:import('./move.js').Move|null, score:number, nodes:number, depth:number}}
 */
export function findBestMove(position, { level = 4, maxDepth, timeLimitMs, nodeLimit, onInfo } = {}) {
  const searcher = new Searcher();

  // Level mapping: depth + randomness for weakness
  const levelConfig = {
    1: { depth: 1, time: 200, random: 0.6 },
    2: { depth: 2, time: 300, random: 0.4 },
    3: { depth: 2, time: 500, random: 0.2 },
    4: { depth: 3, time: 800, random: 0 },
    5: { depth: 4, time: 1500, random: 0 },
    6: { depth: 5, time: 2500, random: 0 },
    7: { depth: 6, time: 4000, random: 0 },
    8: { depth: 7, time: 6000, random: 0 },
  };

  const config = levelConfig[level] || levelConfig[4];
  const depth = maxDepth || config.depth;
  const time = timeLimitMs || config.time;
  const randomFactor = config.random;

  const result = searcher.iterativeDeepening(position, {
    maxDepth: depth,
    timeLimitMs: time,
    nodeLimit,
    onInfo,
  });

  // Deliberate weakness at low levels: sometimes pick 2nd best
  if (randomFactor > 0 && Math.random() < randomFactor) {
    const moves = position.legalMoves();
    if (moves.length > 1) {
      // Pick a random move that is not the best, but still plausible
      const alternatives = moves.filter((m) => !result.move || m.from !== result.move.from || m.to !== result.move.to);
      if (alternatives.length > 0) {
        const randomMove = alternatives[Math.floor(Math.random() * alternatives.length)];
        return { move: randomMove, score: result.score - 200, nodes: result.nodes, depth: result.depth, random: true };
      }
    }
  }

  return { ...result, random: false };
}

export { MATE_SCORE, INF };
