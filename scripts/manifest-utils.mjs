/**
 * Shared helpers for the manifest tooling (`sync-manifest`, `check-manifest`).
 *
 * The manifest is partially generated: the platform list in
 * `src/shared/platforms.js` is the single source of truth for hosts, so these
 * helpers derive the manifest fragments and validate that everything still line
 * up. Run `npm run sync:manifest` after changing platforms.
 *
 * @module scripts/manifest-utils
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = path.join(ROOT, "manifest.json");

/**
 * @param {string} file
 * @returns {Promise<string>} file contents.
 */
export async function readText(file) {
  return readFile(path.join(ROOT, file), "utf8");
}

/**
 * @returns {Promise<object>} the parsed manifest.
 */
export async function readManifest() {
  return JSON.parse(await readText("manifest.json"));
}

/**
 * Loads the platform registry by importing the ESM module directly, so the
 * scripts and the extension can never disagree about the host list.
 *
 * @returns {Promise<import('../src/shared/platforms.js')>} the platforms module.
 */
export async function loadPlatforms() {
  return import(path.join(ROOT, "src/shared/platforms.js"));
}

/**
 * @returns {Promise<string>} the version declared in `src/shared/meta.js`.
 */
export async function readMetaVersion() {
  const source = await readText("src/shared/meta.js");
  const match = /APP_VERSION\s*=\s*"([^"]+)"/.exec(source);
  return match ? match[1] : "";
}

/**
 * Collects every local module reachable from an entry point.
 *
 * @param {string} entry repository-relative path, e.g. `src/content/main.js`.
 * @returns {Promise<string[]>} repository-relative paths, entry first.
 */
export async function collectModuleGraph(entry) {
  const seen = new Set();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);

    const source = await readText(file);
    for (const specifier of findImportSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        continue;
      }
      const resolved = path
        .relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), specifier))
        .split(path.sep)
        .join("/");
      if (!seen.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return [...seen];
}

/**
 * @param {string} source
 * @returns {string[]} module specifiers used by static `import`/`export ... from`.
 */
export function findImportSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+[^'"]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+[^'"]*?from\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match !== null) {
      specifiers.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return specifiers;
}

/**
 * @param {string} pattern a `web_accessible_resources` entry.
 * @param {string} file repository-relative path.
 * @returns {boolean} true when the pattern covers the file.
 */
export function resourcePatternMatches(pattern, file) {
  if (!pattern.includes("*")) {
    return pattern === file;
  }
  const [prefix, suffix] = pattern.split("*");
  return file.startsWith(prefix) && (suffix === "" || file.endsWith(suffix));
}

/**
 * @returns {Promise<string[]>} every JavaScript file under `src/`, sorted.
 */
export async function listSourceFiles() {
  const files = [];
  const walk = async (directory) => {
    for (const entry of await readdir(path.join(ROOT, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(relative);
      } else if (entry.name.endsWith(".js")) {
        files.push(relative);
      }
    }
  };
  await walk("src");
  return files.sort();
}

/**
 * @param {string} file repository-relative path.
 * @returns {Promise<boolean>} true when the file exists.
 */
export async function fileExists(file) {
  try {
    await stat(path.join(ROOT, file));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {string[]} options.hosts
 * @returns {{hostPermissions: string[], matches: string[]}} manifest fragments.
 */
export function hostFragments({ hosts }) {
  const patterns = hosts.map((host) => `https://${host}/*`);
  return { hostPermissions: [...patterns], matches: [...patterns] };
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{missing: string[], extra: string[]}} set difference in both directions.
 */
export function diffSets(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  return {
    missing: a.filter((item) => !right.has(item)),
    extra: b.filter((item) => !left.has(item)),
  };
}
