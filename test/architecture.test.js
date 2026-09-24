import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectModuleGraph } from "../scripts/manifest-utils.mjs";
import { installFakeChrome } from "./helpers/fake-chrome.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} file repository-relative path.
 * @returns {Promise<string>} file contents.
 */
const read = (file) => readFile(path.join(ROOT, file), "utf8");

/**
 * Removes comments so that prose such as "the side panel document." is not
 * mistaken for a DOM access.
 *
 * @param {string} source
 * @returns {string} the source without comments.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * @param {string[]} files
 * @returns {Promise<Array<{file: string, source: string}>>} the sources, comments removed.
 */
async function readAll(files) {
  return Promise.all(files.map(async (file) => ({ file, source: stripComments(await read(file)) })));
}

test("background code never touches window or document (service workers have neither)", async () => {
  const files = await collectModuleGraph("src/background/index.js");
  assert.ok(files.length >= 2);

  for (const { file, source } of await readAll(files)) {
    assert.ok(!/\bwindow\s*\./.test(source), `${file} uses window; a service worker has no window`);
    assert.ok(!/\bdocument\s*\./.test(source), `${file} uses document; a service worker has no DOM`);
    assert.ok(!/\balert\s*\(/.test(source), `${file} must not block the worker with alert()`);
  }
});

test("the chess core and shared helpers stay free of DOM and extension APIs", async () => {
  const files = [
    ...(await collectModuleGraph("src/core/index.js")),
    ...(await collectModuleGraph("src/shared/index.js")),
    "src/ui/game.js",
    "src/ui/status.js",
  ];

  for (const { file, source } of await readAll(files)) {
    assert.ok(!/\bdocument\s*\./.test(source), `${file} uses document`);
    assert.ok(!/\bwindow\s*\./.test(source), `${file} uses window`);
    assert.ok(!/\bchrome\s*\./.test(source), `${file} uses the extension API`);
    assert.ok(!/\binnerHTML\b/.test(source), `${file} builds DOM from strings`);
  }
});

test("the side panel renders through textContent, never innerHTML", async () => {
  for (const { file, source } of await readAll(await collectModuleGraph("src/ui/main.js"))) {
    assert.ok(!/\binnerHTML\b/.test(source), `${file} uses innerHTML`);
    assert.ok(!/\bouterHTML\b/.test(source), `${file} uses outerHTML`);
    assert.ok(!/\binsertAdjacentHTML\b/.test(source), `${file} uses insertAdjacentHTML`);
    assert.ok(!/document\.write\b/.test(source), `${file} uses document.write`);
  }
});

test("no layer loads remote code or opens a network connection", async () => {
  const files = [
    ...(await collectModuleGraph("src/ui/main.js")),
    ...(await collectModuleGraph("src/background/index.js")),
    ...(await collectModuleGraph("src/content/index.js")),
  ];

  for (const { file, source } of await readAll([...new Set(files)])) {
    assert.ok(!/\bfetch\s*\(/.test(source), `${file} calls fetch`);
    assert.ok(!/\bXMLHttpRequest\b/.test(source), `${file} uses XMLHttpRequest`);
    assert.ok(!/\bWebSocket\b/.test(source), `${file} uses WebSocket`);
    assert.ok(!/\bEventSource\b/.test(source), `${file} uses EventSource`);
    assert.ok(!/\bnavigator\.sendBeacon\b/.test(source), `${file} sends beacons`);
    assert.ok(!/\beval\s*\(/.test(source), `${file} calls eval`);
    assert.ok(!/\bnew\s+Function\b/.test(source), `${file} compiles code from strings`);
    assert.ok(!/import\s*\(\s*["'`]https?:/.test(source), `${file} imports remote code`);
  }
});

test("the content bootstrap is the only classic script and it guards double injection", async () => {
  const source = await read("src/content/index.js");
  assert.ok(!/^\s*import\s/m.test(source), "the bootstrap must stay a classic script");
  assert.match(source, /chrome\.runtime\.getURL\("src\/content\/main\.js"\)/);
  assert.match(source, /__AI_CHESS_COMPANION_BOOTSTRAPPED__/);

  const entry = await read("src/content/main.js");
  assert.match(entry, /__AI_CHESS_COMPANION_STARTED__/);
  assert.match(entry, /export function start\(\)/);
});

test("the manifest declares the module service worker and no content-script modules", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.content_scripts[0].js.length, 1);
  assert.ok(!("type" in manifest.content_scripts[0]), "MV3 does not support module content scripts");
  assert.ok(manifest.minimum_chrome_version, "the minimum Chrome version must be pinned for the APIs used");
});

test("tab descriptions map URLs to platforms", async () => {
  const fake = installFakeChrome();
  try {
    const { describeTab, getActiveTab } = await import("../src/background/panel.js");

    const supported = describeTab({ id: 5, url: "https://chatgpt.com/c/1" });
    assert.deepEqual(supported, { tabId: 5, url: "https://chatgpt.com/c/1", platform: "chatgpt", supported: true });

    const unsupported = describeTab({ id: 6, url: "https://example.com/" });
    assert.equal(unsupported.supported, false);
    assert.equal(unsupported.platform, "");

    const missingId = describeTab({ url: "https://claude.ai/chat" });
    assert.equal(missingId.tabId, null, "a tab without an id cannot receive messages");
    assert.equal(missingId.supported, true);

    assert.equal(describeTab(undefined).tabId, null);

    const active = await getActiveTab();
    assert.equal(active.tabId, 7);
    assert.equal(active.platform, "chatgpt");
  } finally {
    fake.restore();
  }
});

test("badge updates never throw when the tabs API is unavailable", async () => {
  const fake = installFakeChrome();
  try {
    const { updateBadge } = await import("../src/background/panel.js");
    const originalAction = globalThis.chrome.action;
    delete globalThis.chrome.action;
    await assert.doesNotReject(updateBadge({ supported: true, platform: "chatgpt" }));
    globalThis.chrome.action = originalAction;
  } finally {
    fake.restore();
  }
});

test("the storage helper degrades gracefully without an extension context", async () => {
  const previous = globalThis.chrome;
  delete globalThis.chrome;
  try {
    const { readValue, writeValue, removeValue } = await import("../src/shared/storage.js");
    assert.equal(await readValue("missing", "fallback"), "fallback");
    assert.equal(await writeValue("key", 1), false);
    assert.equal(await removeValue("key"), false);
  } finally {
    globalThis.chrome = previous;
  }
});

test("settings are validated on read", async () => {
  const { normaliseSettings, DEFAULT_SETTINGS, mergeSettings } = await import("../src/shared/settings.js");

  assert.deepEqual(normaliseSettings(undefined), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normaliseSettings("nonsense"), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normaliseSettings({ theme: "neon", playerColor: "x", maxRetries: 99 }), {
    ...DEFAULT_SETTINGS,
    maxRetries: 5,
  });
  assert.deepEqual(normaliseSettings({ maxRetries: -3 }).maxRetries, 0);
  assert.equal(normaliseSettings({ persistGame: "yes" }).persistGame, DEFAULT_SETTINGS.persistGame);
  assert.equal(mergeSettings({ autoRetry: false }).showCoordinates, DEFAULT_SETTINGS.showCoordinates);
});

test("new settings are persisted and clamped without fake low Elo", async () => {
  const { normaliseSettings } = await import("../src/shared/settings.js");
  const bad = normaliseSettings({
    sendMode: "unsafe",
    generationWaitMs: 999999,
    soundVolume: 99,
    clockDurationMs: 500,
    matchAnchorElo: -500,
    matchMoveTimeMs: 50,
    paused: "true",
  });
  assert.equal(bad.sendMode, "auto");
  assert.equal(bad.generationWaitMs, 180000);
  assert.equal(bad.soundVolume, 1);
  assert.equal(bad.clockDurationMs, 60000);
  assert.equal(bad.matchMoveTimeMs, 100);
  assert.equal(bad.paused, false);
  // Settings storage cannot pretend a sub-minimum value was ever played;
  // the UCI controller clamps again to its binary-reported range at startup.
  const { clampUciElo } = await import("../src/ui/stockfish.js");
  assert.equal(clampUciElo(bad.matchAnchorElo, { min: 1320, max: 3190 }), 1320);
});
