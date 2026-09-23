import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectModuleGraph } from "../scripts/manifest-utils.mjs";
import { checkDictionaries, extractTranslationKeys, getDictionary } from "../src/shared/i18n.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(ROOT, file), "utf8");

test("dictionaries have identical keys for en and vi", () => {
  const result = checkDictionaries();
  assert.equal(result.ok, true, `missing: ${JSON.stringify(result.missing)}, extra: ${JSON.stringify(result.extra)}`);
  const en = getDictionary("en");
  const vi = getDictionary("vi");
  assert.ok(Object.keys(en).length > 50, "en should have many keys");
  assert.equal(Object.keys(en).length, Object.keys(vi).length, "en and vi must have same key count");
});

test("no user-facing string bypasses t() in side panel", async () => {
  const graph = await collectModuleGraph("src/ui/main.js");
  // Also include app.js which is main consumer
  const files = [...new Set([...graph, "src/ui/app.js", "src/ui/status.js", "src/ui/board.js", "src/ui/history.js"])];
  const forbiddenPatterns = [
    /Your move\. Playing as/,
    /Waiting for .* to answer/,
    /No AI chat detected/,
    /Game over/,
    /Checkmate/,
  ];

  for (const file of files) {
    const source = await read(file);
    // Skip if file is pure logic without UI strings
    if (file.includes("board.js") || file.includes("history.js")) continue;
    for (const pattern of forbiddenPatterns) {
      // If source contains hardcoded English that should be via t(), fail
      // Allow if it's inside a fallback (t ? t() : "English") — that's okay, but direct textContent = "Your move" is not
      const lines = source.split("\n");
      for (const line of lines) {
        if (pattern.test(line) && line.includes("textContent") && !line.includes("t(") && !line.includes("tr(")) {
          // Check if line is fallback: contains ? and : with t()
          if (line.includes("?") && line.includes(":")) continue;
          assert.fail(`${file} has hardcoded UI string bypassing t(): ${line.trim()}`);
        }
      }
    }
  }
});

test("translation keys used in code exist in dictionaries", async () => {
  const graph = await collectModuleGraph("src/ui/main.js");
  const files = [...new Set([...graph, "src/ui/app.js"])];
  const dict = getDictionary("en");
  const allKeys = new Set(Object.keys(dict));

  for (const file of files) {
    const source = await read(file);
    const keys = extractTranslationKeys(source).filter((k) => k.includes(".") && k.length > 3 && k !== "...");
    for (const key of keys) {
      assert.ok(allKeys.has(key), `${file} uses translation key "${key}" that does not exist in en dictionary`);
    }
  }
});
