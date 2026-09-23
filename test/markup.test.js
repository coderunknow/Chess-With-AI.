import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectModuleGraph, resourcePatternMatches } from "../scripts/manifest-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} file repository-relative path.
 * @returns {Promise<string>} file contents.
 */
const read = (file) => readFile(path.join(ROOT, file), "utf8");

/**
 * @param {string} html
 * @returns {string[]} every `id` attribute value.
 */
function idsIn(html) {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
}

const html = await read("sidepanel.html");
const main = await read("src/ui/main.js");
const app = await read("src/ui/app.js");

test("every id used by main.js exists in sidepanel.html", () => {
  const htmlIds = new Set(idsIn(html));
  const used = [...main.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);

  assert.ok(used.length > 20, "main.js should wire up the whole panel");
  for (const id of used) {
    assert.ok(htmlIds.has(id), `main.js references missing #${id}`);
  }
});

test("every id used by app.js exists in sidepanel.html", () => {
  const htmlIds = new Set(idsIn(html));
  const used = [...app.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
  for (const id of used) {
    assert.ok(htmlIds.has(id), `app.js references missing #${id}`);
  }
});

test("element ids are unique", () => {
  const ids = idsIn(html);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `duplicate ids: ${duplicates.join(", ")}`);
});

test("the panel loads the entry module and nothing else", () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /type="module"/);
  assert.match(scripts[0], /src="src\/ui\/main\.js"/);
});

test("the panel only references local assets", () => {
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(references.length >= 2);
  for (const reference of references) {
    assert.ok(!/^[a-z]+:\/\//i.test(reference), `remote asset is not allowed: ${reference}`);
    assert.ok(!reference.startsWith("//"), `protocol relative asset is not allowed: ${reference}`);
  }
});

test("every panel asset exists", async () => {
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    await assert.doesNotReject(read(reference), `${reference} is missing`);
  }
});

test("dialogs are declared as native dialog elements", () => {
  for (const id of ["promotion-dialog", "settings-dialog", "pgn-dialog"]) {
    assert.match(html, new RegExp(`<dialog[^>]+id="${id}"`), `#${id} must be a <dialog>`);
  }
  for (const id of ["promotion-title", "settings-title", "pgn-title"]) {
    assert.ok(idsIn(html).includes(id), `#${id} must label its dialog`);
  }
});

test("the settings dialog covers every toggle the app reads", () => {
  const toggles = [...html.matchAll(/data-setting="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(toggles.sort(), [
    "autoRetry",
    "highlightLastMove",
    "persistGame",
    "showCoordinates",
    "showLegalTargets",
  ]);
});

test("the promotion dialog offers exactly the four promotion pieces", () => {
  const pieces = [...html.matchAll(/data-piece="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(pieces, ["b", "n", "q", "r"]);
});

test("the markup declares a theme and loads the stylesheet", async () => {
  assert.match(html, /data-theme="(dark|light)"/);
  assert.match(html, /href="src\/ui\/theme\.css"/);
  const css = await read("src/ui/theme.css");
  assert.ok(css.includes('[data-theme="light"]'), "the light theme must be defined");
  assert.ok(css.includes('[data-theme="dark"]'), "the dark theme must be defined");
});

test("accessibility basics are present", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<meta name="viewport"/);
  assert.ok(html.includes('aria-label="Chess board"'));
});

test("the side panel module graph is complete and DOM only", async () => {
  const graph = await collectModuleGraph("src/ui/main.js");
  assert.ok(graph.length >= 10, `expected a real module graph, got ${graph.length} files`);
  for (const file of graph) {
    await assert.doesNotReject(read(file), `${file} is missing`);
  }
});

test("the content script module graph is covered by web_accessible_resources", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  const patterns = manifest.web_accessible_resources[0].resources;
  const graph = await collectModuleGraph("src/content/main.js");

  assert.ok(graph.includes("src/content/bridge.js"));
  assert.ok(graph.includes("src/shared/prompt.js"), "the bridge shares the prompt helpers");
  for (const file of graph) {
    assert.ok(
      patterns.some((pattern) => resourcePatternMatches(pattern, file)),
      `${file} is not web accessible, so its dynamic import would fail silently`,
    );
  }
});

test("no source file fetches remote resources", async () => {
  const graph = [
    ...(await collectModuleGraph("src/ui/main.js")),
    ...(await collectModuleGraph("src/content/index.js")),
    ...(await collectModuleGraph("src/background/index.js")),
  ];
  for (const file of graph) {
    const source = await read(file);
    assert.ok(!/\bfetch\s*\(/.test(source), `${file} must not call fetch`);
    assert.ok(!/\bXMLHttpRequest\b/.test(source), `${file} must not use XMLHttpRequest`);
    assert.ok(!/\bWebSocket\b/.test(source), `${file} must not open sockets`);
    assert.ok(!/\beval\s*\(/.test(source), `${file} must not call eval`);
    assert.ok(!/\bnew Function\b/.test(source), `${file} must not build functions from strings`);
    assert.ok(!/innerHTML\s*=/.test(source), `${file} must not assign innerHTML`);
  }
});
