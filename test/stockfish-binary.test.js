import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Position } from "../src/core/position.js";
import { parseUciEloRange, STOCKFISH_JS, STOCKFISH_WASM } from "../src/ui/stockfish.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsPath = path.join(ROOT, STOCKFISH_JS);
const wasmPath = path.join(ROOT, STOCKFISH_WASM);

/** Execute the *actual packaged bytes* as CommonJS, which is how upstream's
 * unmodified classic worker exposes its factory in Node. The normal extension
 * path instead loads these same bytes as a classic browser Worker. */
test(
  "vendored single-threaded Stockfish WASM reports its own range and plays a legal move",
  { timeout: 15000 },
  async () => {
    const source = await readFile(jsPath);
    const wasm = await readFile(wasmPath);
    const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest(source), "1c8265e52fdaef797684b4979b42c5dcfe0350df3e11a87e48e4ec5f86e0ca5c");
    assert.equal(digest(wasm), "7ca31bedd166148931a1cc84dbd8dd9cf001744e9994caf23a3c6ff4988d7086");
    const sourceBundle = await readFile(
      path.join(ROOT, "engine/stockfish/stockfish.js-v17.1.0-lite-single-source.tar.gz"),
    );
    assert.equal(digest(sourceBundle), "123d462bb280e6e406a3f65914cc816565677cac9bb123f0b474bee40b6cf310");
    const gpl = await readFile(path.join(ROOT, "engine/stockfish/COPYING-GPL-3.0.txt"));
    assert.equal(digest(gpl), "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903");
    const sourceList = await readFile(path.join(ROOT, "engine/stockfish/source-files.sha256"), "utf8");
    assert.equal(sourceList.trim().split("\n").length, 84);
    assert.match(sourceList, /src\/nn-9067e33176e8\.nnue/);
    assert.match(sourceList, /src\/emscripten\/extern-pre-async\.js/);

    const module = new Module(jsPath);
    module.filename = jsPath;
    module.paths = Module._nodeModulePaths(path.dirname(jsPath));
    module._compile(source.toString("utf8"), jsPath);
    const lines = [];
    let acceptBestMove;
    const bestMove = new Promise((resolve) => {
      acceptBestMove = resolve;
    });
    const engine = await module.exports()({
      locateFile: () => wasmPath, // local disk only; no network in this test or worker
      listener: (line) => {
        lines.push(line);
        if (line.startsWith("bestmove ")) acceptBestMove(line);
      },
    });
    const send = (command) => engine.ccall("command", null, ["string"], [command]);
    send("uci");
    assert.ok(lines.includes("uciok"));
    assert.deepEqual(parseUciEloRange(lines), { min: 1320, max: 3190 });
    send("ucinewgame");
    send("setoption name UCI_LimitStrength value true");
    send("setoption name UCI_Elo value 1500");
    send("isready");
    assert.ok(lines.includes("readyok"));
    const position = Position.start();
    send(`position fen ${position.toFen()}`);
    send("go movetime 120");
    const timer = setTimeout(() => acceptBestMove(""), 8000);
    try {
      const result = await bestMove;
      const move = /^bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(result)?.[1];
      assert.ok(position.moveFromUci(move), `the real Stockfish move must be legal: ${result}`);
    } finally {
      clearTimeout(timer);
    }
  },
);
