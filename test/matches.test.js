import assert from "node:assert/strict";
import test from "node:test";

import {
  aiScore,
  appendRatedMatch,
  emptyMatches,
  estimateRating,
  expectedScore,
  normaliseMatches,
} from "../src/shared/matches.js";
import { StockfishEngine, clampMoveTime, clampUciElo, parseUciEloRange } from "../src/ui/stockfish.js";
import { installFakeChrome } from "./helpers/fake-chrome.js";

const RANGE = { min: 1320, max: 3190 };
const game = (result, aiColor = "w", anchorElo = 1500, number = 1) => ({
  id: String(number),
  createdAt: number,
  anchorElo,
  aiColor,
  result,
  platformId: "chatgpt",
  pgn: `[Result "${result}"]\n\n1. e4 e5 ${result}`,
  stockfishMoves: 1,
  chatMoves: 1,
});

test("logistic score and draw-aware bounded MLE with profile-likelihood interval", () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
  assert.ok(Math.abs(expectedScore(1900, 1500) - 10 / 11) < 1e-10);
  const scripted = [
    game("1-0", "w", 1500, 1),
    game("0-1", "b", 1500, 2),
    game("1/2-1/2", "w", 1500, 3),
    game("0-1", "w", 1500, 4),
  ];
  assert.deepEqual(scripted.map(aiScore), [1, 1, 0.5, 0]);
  const result = estimateRating(scripted, 1500, RANGE);
  assert.equal(result.games, 4);
  assert.deepEqual([result.wins, result.draws, result.losses], [2, 1, 1]);
  assert.equal(result.estimate, 1589);
  assert.ok(result.lower < result.estimate && result.upper > result.estimate);
  assert.equal(result.provisional, true);
  assert.equal(estimateRating(scripted, 1600, RANGE), null, "changing anchor starts a separate estimate");
});

test("all wins/losses have one-sided boundary MLE, never a made-up rating below minimum", () => {
  const wins = estimateRating([game("1-0")], 1500, RANGE);
  assert.equal(wins.estimate, RANGE.max);
  assert.equal(wins.upper, RANGE.max);
  assert.equal(wins.provisional, true);
  assert.equal(wins.games, 1);
  const losses = estimateRating([game("0-1")], 1500, RANGE);
  assert.equal(losses.estimate, RANGE.min);
  assert.equal(losses.lower, RANGE.min);
});

test("a sufficiently narrow interval after real rated results is no longer provisional", () => {
  const scripted = Array.from({ length: 80 }, (_, n) => game(n % 2 ? "0-1" : "1-0", "w", 1500, n));
  const result = estimateRating(scripted, 1500, RANGE);
  assert.equal(result.estimate, 1500);
  assert.equal(result.provisional, false);
  assert.ok(result.upper - result.lower < 200);
  const mixed = [...scripted, game("1-0", "w", 1800, 100)];
  assert.equal(estimateRating(mixed, 1500, RANGE).games, 80);
  assert.equal(estimateRating(mixed, 1800, RANGE).games, 1);
});

test("match storage is independent, versioned and discards corrupt/unplayed records", async () => {
  assert.deepEqual(normaliseMatches({ version: 55, games: [game("1-0")] }), emptyMatches());
  assert.equal(normaliseMatches({ version: 1, games: [{ ...game("1-0"), chatMoves: 0 }] }).games.length, 0);
  const fake = installFakeChrome();
  try {
    const next = await appendRatedMatch(emptyMatches(), game("1/2-1/2"));
    assert.equal(next.games.length, 1);
    assert.equal(fake.state.storageData.ratedMatches.games.length, 1);
    assert.equal(fake.state.storageData.game, undefined);
  } finally {
    fake.restore();
  }
});

test("only a real UCI handshake authorises an Elo range", () => {
  const lines = [
    "option name Threads type spin default 1 min 1 max 1",
    "option name UCI_LimitStrength type check default false",
    "option name UCI_Elo type spin default 1320 min 1320 max 3190",
  ];
  assert.deepEqual(parseUciEloRange(lines), RANGE);
  assert.throws(() => parseUciEloRange(lines.slice(1, 2)), /UCI_Elo/);
  assert.throws(() => parseUciEloRange(lines.slice(1)), /single-threaded/);
  assert.throws(
    () => parseUciEloRange([lines[1], lines[2], "option name Threads type spin default 2 min 1 max 8"]),
    /single-threaded/,
  );
  assert.equal(clampUciElo(100, RANGE), 1320);
  assert.equal(clampUciElo(9999, RANGE), 3190);
  assert.equal(clampUciElo(1506, RANGE), 1510);
  assert.equal(clampMoveTime(50), 100);
  assert.equal(clampMoveTime(9999), 5000);
});

test("UCI controls cannot search until readyok and cannot overlap new-game configuration", async () => {
  const held = [];
  const engine = new StockfishEngine({
    runtimeUrl: (path) => `chrome-extension://test/${path}`,
    workerFactory: () => ({
      onmessage: null,
      postMessage(line) {
        if (line === "uci")
          queueMicrotask(() => {
            for (const response of [
              "option name Threads type spin default 1 min 1 max 1",
              "option name UCI_LimitStrength type check default false",
              "option name UCI_Elo type spin default 1320 min 1320 max 3190",
              "uciok",
            ])
              this.onmessage({ data: response });
          });
        if (line === "isready") held.push(() => this.onmessage({ data: "readyok" }));
      },
      terminate() {},
    }),
  });
  const boot = engine.boot();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(engine.ready, false, "the UCI range alone does not prove boot completion");
  await assert.rejects(engine.newGame(1500), /not ready/);
  held.shift()();
  await boot;
  assert.equal(engine.ready, true);
  const configuring = engine.newGame(1500);
  assert.equal(held.length, 1);
  await assert.rejects(engine.search("startpos", 1500, 100), /already searching/);
  held.shift()();
  await configuring;
  engine.stop();
  assert.equal(engine.ready, false);
});

test("a stopped boot cannot terminate a newer worker or accept a late old reply", async () => {
  const workers = [];
  const engine = new StockfishEngine({
    runtimeUrl: (path) => `chrome-extension://test/${path}`,
    workerFactory: () => {
      const worker = {
        onmessage: null,
        terminated: false,
        postMessage(line) {
          if (line === "uci")
            queueMicrotask(() => {
              for (const response of [
                "option name Threads type spin default 1 min 1 max 1",
                "option name UCI_LimitStrength type check default false",
                "option name UCI_Elo type spin default 1320 min 1320 max 3190",
                "uciok",
              ])
                this.onmessage({ data: response });
            });
          if (line === "isready" && workers.length > 1) queueMicrotask(() => this.onmessage({ data: "readyok" }));
        },
        terminate() {
          this.terminated = true;
        },
      };
      workers.push(worker);
      return worker;
    },
  });
  const first = engine.boot();
  const rejected = assert.rejects(first, /stopped/);
  await Promise.resolve();
  await Promise.resolve();
  engine.stop();
  const second = engine.boot();
  await rejected;
  workers[0].onmessage({ data: "bestmove a1a1" });
  assert.deepEqual(await second, RANGE);
  assert.equal(workers[1].terminated, false);
  assert.equal(engine.ready, true);
  engine.stop();
});

test("UCI controller sends strength options and go movetime, never Skill Level/depth", async () => {
  const sent = [];
  let scriptURL = "";
  const engine = new StockfishEngine({
    runtimeUrl: (path) => `chrome-extension://test/${path}`,
    workerFactory: (url) => {
      scriptURL = url;
      return {
        onmessage: null,
        postMessage(line) {
          sent.push(line);
          if (line === "uci")
            queueMicrotask(() => {
              for (const response of [
                "id name Stockfish 17.1 Lite WASM",
                "option name Threads type spin default 1 min 1 max 1",
                "option name UCI_LimitStrength type check default false",
                "option name UCI_Elo type spin default 1320 min 1320 max 3190",
                "uciok",
              ])
                this.onmessage({ data: response });
            });
          if (line === "isready") queueMicrotask(() => this.onmessage({ data: "readyok" }));
          if (line.startsWith("go movetime"))
            queueMicrotask(() => this.onmessage({ data: "bestmove e2e4 ponder e7e5" }));
        },
        terminate() {},
      };
    },
  });
  assert.deepEqual(await engine.boot(), RANGE);
  assert.match(scriptURL, /^chrome-extension:\/\/test\/engine\/stockfish\/.*\.js#chrome-extension%3A/);
  assert.equal(await engine.newGame(100), 1320);
  assert.equal(await engine.search("startpos", 9999, 50), "e2e4");
  assert.ok(sent.includes("setoption name UCI_LimitStrength value true"));
  assert.ok(sent.includes("setoption name UCI_Elo value 1320"));
  assert.ok(sent.includes("setoption name UCI_Elo value 3190"));
  assert.ok(sent.includes("go movetime 100"));
  assert.ok(!sent.some((line) => /Skill Level|depth|MultiPV/.test(line)));
  engine.stop();
  assert.equal(engine.ready, false);
});
