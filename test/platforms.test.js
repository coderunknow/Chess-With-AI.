import assert from "node:assert/strict";
import test from "node:test";

import {
  HOST_PATTERNS,
  PLATFORMS,
  SUPPORTED_HOSTS,
  assistantSelectorsForHost,
  inputSelectorsForHost,
  isSupportedUrl,
  platformForHost,
  platformForUrl,
  sendSelectorsForHost,
} from "../src/shared/platforms.js";

/**
 * Node has no CSS selector engine, so validate the structure that typos break
 * most often: balanced brackets, parentheses and quotes.
 *
 * @param {string} selector
 * @returns {boolean}
 */
function isBalancedSelector(selector) {
  if (typeof selector !== "string" || selector.trim() === "") {
    return false;
  }
  const counts = { "[": 0, "(": 0 };
  for (const character of selector) {
    if (character === "[") counts["["] += 1;
    if (character === "]") counts["["] -= 1;
    if (character === "(") counts["("] += 1;
    if (character === ")") counts["("] -= 1;
    if (counts["["] < 0 || counts["("] < 0) return false;
  }
  const quotes = (selector.match(/'/g) || []).length + (selector.match(/"/g) || []).length;
  return counts["["] === 0 && counts["("] === 0 && quotes % 2 === 0;
}

test("platform ids and hosts are unique", () => {
  const ids = PLATFORMS.map((platform) => platform.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate platform id");
  assert.equal(new Set(SUPPORTED_HOSTS).size, SUPPORTED_HOSTS.length, "duplicate host");
});

test("every platform declares the selector groups the bridge needs", () => {
  for (const platform of PLATFORMS) {
    assert.ok(platform.name.length > 0, `${platform.id} needs a name`);
    assert.ok(platform.hosts.length > 0, `${platform.id} needs at least one host`);
    assert.ok(platform.input.length > 0, `${platform.id} needs input selectors`);
    assert.ok(platform.send.length > 0, `${platform.id} needs send selectors`);
    assert.ok(platform.assistant.length > 0, `${platform.id} needs assistant selectors`);
    for (const selector of [...platform.input, ...platform.send, ...platform.assistant, ...platform.user]) {
      assert.ok(isBalancedSelector(selector), `${platform.id} has a malformed selector: ${selector}`);
    }
  }
});

test("host permission patterns match the declared hosts", () => {
  assert.equal(HOST_PATTERNS.length, SUPPORTED_HOSTS.length);
  for (const host of SUPPORTED_HOSTS) {
    assert.ok(HOST_PATTERNS.includes(`https://${host}/*`), `missing pattern for ${host}`);
  }
});

test("URLs are mapped to the right platform", () => {
  assert.equal(platformForUrl("https://gemini.google.com/app/abc")?.id, "gemini");
  assert.equal(platformForUrl("https://chatgpt.com/c/123")?.id, "chatgpt");
  assert.equal(platformForUrl("https://chat.openai.com/")?.id, "chatgpt");
  assert.equal(platformForUrl("https://claude.ai/chat/xyz")?.id, "claude");
  assert.equal(platformForUrl("https://grok.com/chat")?.id, "grok");
  assert.equal(platformForUrl("https://www.perplexity.ai/search?q=1")?.id, "perplexity");
  assert.equal(platformForUrl("https://copilot.microsoft.com/chats/1")?.id, "copilot");
});

test("unsupported or unsafe URLs are rejected", () => {
  assert.equal(platformForUrl("https://example.com/"), null);
  assert.equal(platformForUrl("http://chatgpt.com/"), null, "plain http is not supported");
  assert.equal(platformForUrl("https://chatgpt.com.evil.test/"), null, "suffix spoofing must not match");
  assert.equal(platformForUrl("chrome://extensions"), null);
  assert.equal(platformForUrl(""), null);
  assert.equal(platformForUrl(undefined), null);
  assert.equal(platformForUrl("not a url"), null);
  assert.equal(isSupportedUrl("https://claude.ai/new"), true);
  assert.equal(isSupportedUrl("https://evil.test/claude.ai"), false);
});

test("selector lookups fall back to the generic sets", () => {
  const chatgpt = inputSelectorsForHost("chatgpt.com");
  assert.equal(chatgpt[0], "#prompt-textarea");
  assert.ok(chatgpt.includes("textarea"), "generic selectors are appended");

  const unknown = inputSelectorsForHost("example.com");
  assert.ok(unknown.length > 0, "generic selectors are always available");
  assert.ok(!inputSelectorsForHost(undefined).length !== 0);

  assert.ok(sendSelectorsForHost("gemini.google.com").includes("button.send-button"));
  assert.deepEqual(assistantSelectorsForHost("unknown.test"), []);
});

test("platformForHost is case-insensitive", () => {
  assert.equal(platformForHost("ChatGPT.com")?.id, "chatgpt");
  assert.equal(platformForHost("WWW.PERPLEXITY.AI")?.id, "perplexity");
  assert.equal(platformForHost("example.com"), null);
});
