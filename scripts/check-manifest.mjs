#!/usr/bin/env node
/**
 * Validates the extension manifest against the source of truth in
 * `src/shared/platforms.js` and the module graph of the content script.
 *
 * Run with `npm run check:manifest` (also part of CI). Exits non-zero with a
 * readable list of problems.
 *
 * @module scripts/check-manifest
 */

import {
  ROOT,
  collectModuleGraph,
  diffSets,
  fileExists,
  hostFragments,
  listSourceFiles,
  loadPlatforms,
  readManifest,
  readMetaVersion,
  resourcePatternMatches,
} from "./manifest-utils.mjs";
import path from "node:path";

/** @type {string[]} */
const problems = [];

/**
 * @param {boolean} condition
 * @param {string} message
 */
function check(condition, message) {
  if (!condition) {
    problems.push(message);
  }
}

const manifest = await readManifest();
const platformsModule = await loadPlatforms();
const { SUPPORTED_HOSTS, HOST_PATTERNS } = platformsModule;
const metaVersion = await readMetaVersion();

check(manifest.manifest_version === 3, "manifest_version must be 3");
check(manifest.version === metaVersion, `manifest version "${manifest.version}" != APP_VERSION "${metaVersion}"`);

const descriptionLength = manifest.description.length;
check(descriptionLength <= 132, `description is ${descriptionLength} characters (limit 132)`);

for (const field of ["name", "version", "description", "background", "side_panel", "content_scripts", "icons"]) {
  check(Boolean(manifest[field]), `manifest is missing "${field}"`);
}

// --- permissions -----------------------------------------------------------------
const allowedPermissions = new Set(["sidePanel", "scripting", "storage", "activeTab"]);
for (const permission of manifest.permissions) {
  check(allowedPermissions.has(permission), `unexpected permission "${permission}"`);
}
check(!manifest.permissions.includes("tabs"), '"tabs" is not needed: host permissions cover the AI hosts');

// --- hosts ------------------------------------------------------------------------
const fragments = hostFragments({ hosts: SUPPORTED_HOSTS });
const hostDiff = diffSets(fragments.hostPermissions, manifest.host_permissions);
check(hostDiff.missing.length === 0, `host_permissions is missing: ${hostDiff.missing.join(", ")}`);
check(hostDiff.extra.length === 0, `host_permissions has entries with no platform: ${hostDiff.extra.join(", ")}`);
check(
  diffSets(HOST_PATTERNS, manifest.host_permissions).missing.length === 0,
  "HOST_PATTERNS and host_permissions disagree",
);

const contentScript = manifest.content_scripts[0];
check(manifest.content_scripts.length === 1, "exactly one content script entry is expected");
const matchDiff = diffSets(fragments.matches, contentScript.matches);
check(matchDiff.missing.length === 0, `content_scripts.matches is missing: ${matchDiff.missing.join(", ")}`);
check(
  matchDiff.extra.length === 0,
  `content_scripts.matches has entries with no platform: ${matchDiff.extra.join(", ")}`,
);

// --- files referenced by the manifest --------------------------------------------
const referencedFiles = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  ...contentScript.js,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
];
for (const file of new Set(referencedFiles)) {
  check(await fileExists(file), `manifest references a missing file: ${file}`);
}

// --- side panel module graph ------------------------------------------------------
const panelSource = await (await import("node:fs/promises")).readFile(path.join(ROOT, "sidepanel.html"), "utf8");
// v0.2.1-patch: sidepanel now has theme-init.js (classic) + main.js (module). Find the module entry.
const moduleMatch =
  /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(panelSource) ||
  /<script[^>]*src="([^"]+)"[^>]*type="module"/.exec(panelSource);
const panelEntry = moduleMatch?.[1] || /<script[^>]+src="([^"]+)"/.exec(panelSource)?.[1];
check(Boolean(panelEntry), "sidepanel.html does not load a module");
if (panelEntry) {
  check(await fileExists(panelEntry), `sidepanel.html references a missing script: ${panelEntry}`);
  const panelGraph = await collectModuleGraph(panelEntry);
  check(panelGraph.length > 1, "the side panel entry should import other modules");
}

// --- content script module graph must be web-accessible ---------------------------
const bootstrap = contentScript.js[0];
const warEntry = manifest.web_accessible_resources[0];
check(Boolean(warEntry), "web_accessible_resources is required for dynamic imports");

if (warEntry) {
  const graph = await collectModuleGraph(bootstrap.replace(/index\.js$/, "main.js"));
  const uncovered = graph.filter(
    (file) => !warEntry.resources.some((pattern) => resourcePatternMatches(pattern, file)),
  );
  check(
    uncovered.length === 0,
    `web_accessible_resources does not cover: ${uncovered.join(", ")} (dynamic imports would fail silently)`,
  );

  const warMatchDiff = diffSets(fragments.matches, warEntry.matches);
  check(
    warMatchDiff.missing.length === 0,
    `web_accessible_resources.matches is missing: ${warMatchDiff.missing.join(", ")}`,
  );
  check(warMatchDiff.extra.length === 0, "web_accessible_resources.matches has entries with no platform");

  for (const pattern of warEntry.resources) {
    const matches = (await listSourceFiles()).some((file) => resourcePatternMatches(pattern, file));
    check(matches, `web_accessible_resources pattern matches no file: ${pattern}`);
  }
}

// --- generated data files ---------------------------------------------------------
const platformsPath = "src/shared/platforms.js";
check(await fileExists(platformsPath), `${platformsPath} is missing`);

if (problems.length > 0) {
  console.error(`manifest check failed with ${problems.length} problem(s):`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  `manifest OK — ${SUPPORTED_HOSTS.length} hosts, ${manifest.permissions.length} permissions, version ${manifest.version}`,
);
