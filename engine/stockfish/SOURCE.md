# Vendored Stockfish (separate GPL-3 component)

**Stockfish.js v17.1.0, lite single-threaded NNUE WASM** (build suffix `03e3232`),
by the Stockfish developers and Chess.com LLC. The files here are copied **unchanged**
from the upstream published package, including the JS copyright header, `AUTHORS`
and `COPYING-GPL-3.0.txt` (GNU GPL version 3). The extension's original UCI
controller and UI are MIT-licensed; distributors of the combined package must
honour the engine's GPL-3 obligations. This is not an npm runtime dependency.

**Corresponding source is included in the extension archive:**
`stockfish.js-v17.1.0-lite-single-source.tar.gz` (SHA-256
`123d462bb280e6e406a3f65914cc816565677cac9bb123f0b474bee40b6cf310`).
It contains **84 byte-for-byte upstream files** from commit
`f9512ef9aff391026813a56855dd086cb72a2d58`: the chess-engine C++ and
headers, Emscripten glue and makefile, upstream build scripts, authors,
GPL notices, and the **actual lite NNUE net** `nn-9067e33176e8.nnue`.
`source-files.sha256` enumerates each original path and SHA-256. Unpack with
`tar -xzf stockfish.js-v17.1.0-lite-single-source.tar.gz`; upstream's build
requires Emscripten and its build-time tooling, not an extension dependency.
Only other variants' compiled outputs and their unrelated standard/ultra-lite
nets are omitted. The full upstream snapshot (including those variants) is
available at the exact commit:
https://github.com/nmrugg/stockfish.js/tree/f9512ef9aff391026813a56855dd086cb72a2d58.
Official Stockfish project: https://github.com/official-stockfish/Stockfish.

Upstream binary provenance:

- Published binary archive: https://registry.npmjs.org/stockfish/-/stockfish-17.1.0.tgz
  (`sha256 f6473919fcd9dc1a3e6a8f30fb5e3b7e6a57d966b36c8ad0959fce7aca7ec5fc`).
- Copied package paths: `src/stockfish-17.1-lite-single-03e3232.js`,
  `src/stockfish-17.1-lite-single-03e3232.wasm`, `Copying.txt`, `AUTHORS`.

| File | SHA-256 |
| --- | --- |
| JS | `1c8265e52fdaef797684b4979b42c5dcfe0350df3e11a87e48e4ec5f86e0ca5c` |
| WASM | `7ca31bedd166148931a1cc84dbd8dd9cf001744e9994caf23a3c6ff4988d7086` |
| GPL text | `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903` |

`test/stockfish-binary.test.js` executes **these exact JS/WASM bytes** under
Node using upstream's CommonJS factory and local WASM, not a mock or a guessed
Elo from search depth. The real `uci` handshake reports `Stockfish 17.1 Lite
WASM`, `Threads ... min 1 max 1`, `UCI_LimitStrength type check`, and
`UCI_Elo type spin default 1320 min 1320 max 3190`; setting strength-limited
play to 1500 and `go movetime 120` produces a legal UCI `bestmove`.
NNUE loaded from the embedded network (`nn-9067e33176e8.nnue`); no network
request or separate net is required. The browser controller reads min/max again
at runtime and refuses to estimate a rating if the engine fails to boot.

The JS is a **classic worker**, not imported into the extension's ESM module
graph. The worker loads its `.wasm` from the packaged `chrome.runtime.getURL`
URL supplied in the worker URL fragment. No remote resource is used.
