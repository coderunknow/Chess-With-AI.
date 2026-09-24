#!/usr/bin/env node
/**
 * Builds the Chrome Web Store archive.
 *
 * Uses the system `zip` binary so the extension keeps its zero-dependency
 * promise. Only files the browser needs are included: the manifest, the HTML
 * entry point, `src/`, `icons/` and the licence.
 *
 * Usage: `npm run package` -> `build/ai-chess-companion-<version>.zip`
 *
 * @module scripts/package
 */

import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ROOT, readManifest, readMetaVersion } from "./manifest-utils.mjs";

const execFileAsync = promisify(execFile);

const INCLUDED = [
  "manifest.json",
  "sidepanel.html",
  "src",
  "engine/stockfish",
  "icons",
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
];

const manifest = await readManifest();
const version = await readMetaVersion();
const buildDirectory = path.join(ROOT, "build");
const archive = path.join(buildDirectory, `ai-chess-companion-${version}.zip`);

await mkdir(buildDirectory, { recursive: true });
await rm(archive, { force: true });

try {
  await execFileAsync("zip", ["-r", "-q", archive, ...INCLUDED], { cwd: ROOT });
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error("The `zip` command is required to build the release archive.");
    process.exit(1);
  }
  throw error;
}

const { stdout } = await execFileAsync("du", ["-h", archive]);
console.log(`packed ${manifest.name} ${version} -> ${path.relative(ROOT, archive)} (${stdout.split("\t")[0]})`);
