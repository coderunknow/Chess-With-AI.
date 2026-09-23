#!/usr/bin/env node
/**
 * Regenerates the generated parts of `manifest.json` from
 * `src/shared/platforms.js` and `src/shared/meta.js`.
 *
 * The manifest is checked in, so the extension stays loadable without a build
 * step; this script only keeps the generated fields in sync. `npm run
 * check:manifest` (CI) fails when the two drift apart.
 *
 * @module scripts/sync-manifest
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { MANIFEST_PATH, ROOT, hostFragments, loadPlatforms, readMetaVersion } from "./manifest-utils.mjs";

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const { SUPPORTED_HOSTS } = await loadPlatforms();
const version = await readMetaVersion();
const { hostPermissions, matches } = hostFragments({ hosts: SUPPORTED_HOSTS });

const previous = JSON.stringify(manifest, null, 2);

manifest.version = version;
manifest.host_permissions = hostPermissions;
manifest.content_scripts[0].matches = matches;
manifest.web_accessible_resources[0].matches = matches;

const next = `${JSON.stringify(manifest, null, 2)}\n`;

if (previous !== JSON.stringify(manifest, null, 2)) {
  await writeFile(MANIFEST_PATH, next, "utf8");
  console.log(`manifest.json updated — version ${version}, ${SUPPORTED_HOSTS.length} hosts`);
} else {
  console.log(`manifest.json already in sync — version ${version}, ${SUPPORTED_HOSTS.length} hosts`);
}

if (!path.isAbsolute(MANIFEST_PATH)) {
  throw new Error(`unexpected manifest path ${MANIFEST_PATH} (root: ${ROOT})`);
}
