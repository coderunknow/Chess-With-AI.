/**
 * UCI controller for the vendored Stockfish.js single-threaded WASM worker.
 * No network methods here: only packaged chrome.runtime.getURL worker URLs.
 * The engine's own UCI handshake, not a hard-coded Elo range, is authoritative.
 *
 * @module ui/stockfish
 */

export const STOCKFISH_JS = "engine/stockfish/stockfish-17.1-lite-single-03e3232.js";
export const STOCKFISH_WASM = "engine/stockfish/stockfish-17.1-lite-single-03e3232.wasm";

/** @param {string[]} lines complete `uci` handshake lines. */
export function parseUciEloRange(lines) {
  const option = lines.find((line) => /^option name UCI_Elo type spin\b/i.test(line));
  const min = /\bmin\s+(-?\d+)/i.exec(option || "");
  const max = /\bmax\s+(-?\d+)/i.exec(option || "");
  if (
    !min ||
    !max ||
    !lines.some((line) => /^option name UCI_LimitStrength type check\b/i.test(line)) ||
    !Number.isInteger(Number(min[1])) ||
    !Number.isInteger(Number(max[1])) ||
    Number(min[1]) >= Number(max[1])
  ) {
    throw new Error("Stockfish did not report usable UCI_LimitStrength and UCI_Elo options.");
  }
  // This match requires a provably single-threaded engine; absent Threads
  // metadata is not proof of that. Never rely on COOP/COEP or inferred limits.
  const threads = lines.find((line) => /^option name Threads type spin\b/i.test(line));
  if (!threads || !/\bmin\s+1\b/.test(threads) || !/\bmax\s+1\b/.test(threads)) {
    throw new Error("A single-threaded Stockfish build (Threads min 1 max 1) is required.");
  }
  return { min: Number(min[1]), max: Number(max[1]) };
}

/** Clamp to the binary-reported range; 10-point steps are a UI control, not a rating below minimum. */
export function clampUciElo(value, range) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) {
    throw new Error("Stockfish UCI_Elo range is unavailable.");
  }
  const requested = Number(value);
  const rounded = Number.isFinite(requested) ? Math.round(requested / 10) * 10 : range.min;
  return Math.max(range.min, Math.min(range.max, rounded));
}

export function clampMoveTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(100, Math.min(5000, Math.round(number))) : 500;
}

export class StockfishEngine {
  #worker = null;
  #lines = [];
  #pending = null;
  #busy = false;
  #booting = false;
  #initialized = false;
  #range = null;
  #workerFactory;
  #runtimeUrl;

  constructor({ workerFactory = (url) => new Worker(url), runtimeUrl = (path) => chrome.runtime.getURL(path) } = {}) {
    this.#workerFactory = workerFactory;
    this.#runtimeUrl = runtimeUrl;
  }

  get range() {
    return this.#range;
  }

  get ready() {
    return Boolean(this.#worker && this.#range && this.#initialized && !this.#booting);
  }

  /** Boot and read UCI_Elo min/max from THIS binary; never substitute defaults. */
  async boot() {
    if (this.ready) return this.range;
    if (this.#booting) throw new Error("Stockfish is already booting.");
    this.stop();
    this.#booting = true;
    let worker;
    try {
      const url = `${this.#runtimeUrl(STOCKFISH_JS)}#${encodeURIComponent(this.#runtimeUrl(STOCKFISH_WASM))}`;
      worker = this.#workerFactory(url);
      this.#worker = worker;
      worker.onmessage = (event) => {
        if (this.#worker === worker) this.#onLine(event.data);
      };
      worker.onerror = (event) => {
        if (this.#worker === worker) this.#fail(event?.message || "Stockfish WASM failed to start.");
      };
      worker.onmessageerror = () => {
        if (this.#worker === worker) this.#fail("Invalid response from Stockfish.");
      };
      this.#lines = [];
      this.#send("uci");
      await this.#wait((line) => line === "uciok", 25000);
      this.#range = parseUciEloRange(this.#lines);
      this.#lines = [];
      this.#send("isready");
      await this.#wait((line) => line === "readyok", 15000);
      if (this.#worker !== worker) throw new Error("Stockfish stopped while booting.");
      this.#initialized = true;
      return this.#range;
    } catch (error) {
      if (!worker || this.#worker === worker) this.stop();
      throw error;
    } finally {
      if (!worker || this.#worker === worker) this.#booting = false;
    }
  }

  /** New game means a new Stockfish hash; its opponent/color is selected by the caller. */
  async newGame(elo) {
    if (!this.ready || this.#busy) throw new Error("Stockfish is not ready.");
    const anchor = clampUciElo(elo, this.#range);
    const worker = this.#worker;
    this.#busy = true;
    try {
      this.#lines = [];
      this.#send("ucinewgame");
      this.#send("setoption name UCI_LimitStrength value true");
      this.#send(`setoption name UCI_Elo value ${anchor}`);
      this.#send("isready");
      await this.#wait((line) => line === "readyok", 15000);
      if (this.#worker !== worker) throw new Error("Stockfish stopped before the new game.");
      return anchor;
    } catch (error) {
      if (this.#worker === worker) this.stop();
      throw error;
    } finally {
      if (this.#worker === worker) this.#busy = false;
    }
  }

  /** Only `go movetime` is used. No depth, noise, Skill Level or MultiPV handicap. */
  async search(fen, elo, timeMs) {
    if (!this.ready || this.#busy) throw new Error("Stockfish is unavailable or already searching.");
    const anchor = clampUciElo(elo, this.#range);
    const duration = clampMoveTime(timeMs);
    const worker = this.#worker;
    this.#busy = true;
    try {
      this.#lines = [];
      this.#send("setoption name UCI_LimitStrength value true");
      this.#send(`setoption name UCI_Elo value ${anchor}`);
      this.#send(`position fen ${fen}`);
      this.#send(`go movetime ${duration}`);
      const line = await this.#wait((text) => /^bestmove\s/.test(text), duration + 15000);
      if (this.#worker !== worker) throw new Error("Stockfish stopped during search.");
      const match = /^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?|\(none\))/i.exec(line);
      if (!match || match[1] === "(none)") throw new Error("Stockfish returned no playable move.");
      return match[1].toLowerCase();
    } catch (error) {
      if (this.#worker === worker) this.stop(); // a hung worker cannot contribute to a rated game
      throw error;
    } finally {
      if (this.#worker === worker) this.#busy = false;
    }
  }

  stop() {
    if (this.#pending) {
      const pending = this.#pending;
      this.#pending = null;
      clearTimeout(pending.timer);
      pending.reject(new Error("Stockfish stopped."));
    }
    this.#worker?.terminate();
    this.#worker = null;
    this.#range = null;
    this.#lines = [];
    this.#busy = false;
    this.#booting = false;
    this.#initialized = false;
  }

  #send(command) {
    if (!this.#worker) throw new Error("Stockfish worker is unavailable.");
    this.#worker.postMessage(command);
  }

  #onLine(value) {
    if (typeof value !== "string") return;
    for (const raw of value.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      this.#lines.push(line);
      if (this.#lines.length > 1000) this.#lines.shift();
      if (this.#pending?.predicate(line)) {
        const pending = this.#pending;
        this.#pending = null;
        clearTimeout(pending.timer);
        pending.resolve(line);
      }
    }
  }

  #wait(predicate, timeout) {
    if (!this.#worker || this.#pending) return Promise.reject(new Error("Stockfish worker is unavailable or busy."));
    const existing = this.#lines.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending = null;
        reject(new Error("Stockfish did not answer in time."));
      }, timeout);
      this.#pending = { predicate, resolve, reject, timer };
    });
  }

  #fail(error) {
    const pending = this.#pending;
    this.#pending = null;
    if (pending) clearTimeout(pending.timer);
    this.stop();
    pending?.reject(new Error(error));
  }
}
