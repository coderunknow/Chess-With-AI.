// @ts-check
/**
 * ESLint flat configuration.
 *
 * The codebase is plain ESM JavaScript, so the rules focus on correctness and
 * on the constraints that actually matter for a Chrome extension: no `eval`,
 * no accidental globals, explicit `chrome`/DOM usage per environment.
 */

import js from "@eslint/js";
import globals from "globals";

/** Rules shared by every source file. */
const sharedRules = {
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
  "no-console": "off",
  eqeqeq: ["error", "smart"],
  "prefer-const": "error",
  "no-var": "error",
  "object-shorthand": ["error", "properties"],
  "no-implicit-coercion": ["error", { boolean: false }],
  "no-param-reassign": ["error", { props: false }],
  "no-throw-literal": "error",
  "no-return-await": "error",
  "require-atomic-updates": "error",
};

export default [
  {
    ignores: ["node_modules/**", "build/**", "coverage/**", "icons/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly",
      },
    },
    rules: sharedRules,
  },
  {
    // Chess core, shared helpers and UI models must stay environment free so
    // they can run in Node, in the service worker and in a page.
    files: ["src/core/**/*.js", "src/shared/**/*.js", "src/ui/game.js", "src/ui/status.js"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "document", message: "Core/shared code must not touch the DOM." },
        { name: "window", message: "Core/shared code must not touch the DOM." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "chrome", property: "runtime", message: "Core/shared code must not use extension APIs." },
        { object: "chrome", property: "tabs", message: "Core/shared code must not use extension APIs." },
      ],
    },
  },
  {
    files: ["src/content/**/*.js"],
    languageOptions: { globals: { ...globals.browser, chrome: "readonly" } },
  },
  {
    files: ["src/background/**/*.js"],
    languageOptions: { globals: { chrome: "readonly", window: "readonly" } },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser, chrome: "readonly" } },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      // Tests deliberately swap globals (chrome, document) around awaits.
      "require-atomic-updates": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
