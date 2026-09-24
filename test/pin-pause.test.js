import assert from "node:assert/strict";
import test from "node:test";

import { installFakeChrome } from "./helpers/fake-chrome.js";
import { FakeMutationObserver, installFakeDom } from "./helpers/fake-dom.js";
import { clearPin, listSupportedTabs, pinTab, resolvePin } from "../src/background/pin.js";
import { MessageType } from "../src/shared/messaging.js";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("pin is one session record; picker uses content titles and host permissions only", async () => {
  const fake = installFakeChrome({
    tabs: [
      { id: 7, url: "https://chatgpt.com/c/1", titleFromContent: "My Chess Conversation" },
      { id: 8, url: "https://claude.ai/chat", titleFromContent: "Second AI" },
      { id: 9, url: "https://example.com/", titleFromContent: "Private unrelated title" },
    ],
  });
  try {
    const tabs = await listSupportedTabs();
    assert.deepEqual(
      tabs.map((tab) => tab.tabId),
      [7, 8],
    );
    assert.equal(tabs[0].title, "My Chess Conversation");
    assert.equal(tabs[0].host, "chatgpt.com");
    assert.equal(await pinTab(9), null, "unsupported tab is never pinnable");
    assert.equal((await pinTab(8)).platformId, "claude");
    assert.equal(fake.state.sessionData.pinnedAiTab.tabId, 8);
    fake.state.activeTab = { tabId: 7, supported: true, url: "https://chatgpt.com/c/1" };
    assert.equal((await resolvePin()).tabId, 8, "focus did not reassign the pin");
    fake.state.tabs[1].url = "https://example.com/";
    assert.equal(await resolvePin(), null);
    assert.equal(fake.state.sessionData.pinnedAiTab, undefined);
    assert.ok(
      fake.state.runtimeMessages.some((msg) => msg.type === MessageType.PIN_CHANGED && msg.reason === "navigated"),
    );
    await clearPin();
  } finally {
    fake.restore();
  }
});

test("a delayed loss notification for the old tab cannot erase a newly pinned tab", async () => {
  const fake = installFakeChrome({
    tabs: [
      { id: 7, url: "https://chatgpt.com/c/old", titleFromContent: "Old" },
      { id: 8, url: "https://claude.ai/chat/new", titleFromContent: "New" },
    ],
  });
  const originalGet = chrome.tabs.get;
  let rejectOld;
  try {
    chrome.tabs.get = (id) =>
      id === 7
        ? new Promise((_resolve, reject) => {
            rejectOld = reject;
          })
        : originalGet(id);
    const lookup = resolvePin();
    for (let i = 0; i < 5 && !rejectOld; i += 1) await Promise.resolve();
    assert.ok(rejectOld);
    assert.equal((await pinTab(8)).tabId, 8);
    rejectOld(new Error("old tab closed"));
    await lookup;
    assert.equal((await resolvePin()).tabId, 8);
    assert.equal(fake.state.sessionData.pinnedAiTab.tabId, 8);
    assert.ok(!fake.state.runtimeMessages.some((message) => message.reason === "closed"));
  } finally {
    chrome.tabs.get = originalGet;
    fake.restore();
  }
});

test("an old tab disappearing while a new selection is pending cannot cancel the new pin", async () => {
  const fake = installFakeChrome({
    tabs: [
      { id: 7, url: "https://chatgpt.com/c/old", titleFromContent: "Old" },
      { id: 8, url: "https://claude.ai/chat/new", titleFromContent: "New" },
    ],
  });
  const originalSend = chrome.tabs.sendMessage;
  let releaseNew;
  try {
    chrome.tabs.sendMessage = (id, message) =>
      id === 8 && message.type === MessageType.PING
        ? new Promise((resolve) => {
            releaseNew = () => {
              chrome.tabs.sendMessage = originalSend;
              resolve({ ok: true, url: "https://claude.ai/chat/new", title: "New" });
            };
          })
        : originalSend(id, message);
    const next = pinTab(8);
    for (let i = 0; i < 5 && !releaseNew; i += 1) await Promise.resolve();
    assert.ok(releaseNew);
    fake.state.tabs[0].url = "https://example.com/";
    assert.equal(await resolvePin(), null, "the old pin cannot be used while replacement is pending");
    assert.equal(
      fake.state.sessionData.pinnedAiTab.tabId,
      7,
      "do not clear storage until the replacement is validated",
    );
    releaseNew();
    assert.equal((await next).tabId, 8);
    assert.equal((await resolvePin()).tabId, 8);
    assert.ok(!fake.state.runtimeMessages.some((message) => message.reason === "navigated"));
  } finally {
    chrome.tabs.sendMessage = originalSend;
    fake.restore();
  }
});

test("a slower first pin cannot overwrite a newer explicit selection", async () => {
  const fake = installFakeChrome({
    tabs: [
      { id: 7, url: "https://chatgpt.com/c/one", titleFromContent: "One" },
      { id: 8, url: "https://claude.ai/chat/two", titleFromContent: "Two" },
    ],
  });
  const originalSend = chrome.tabs.sendMessage;
  let releaseOld;
  try {
    chrome.tabs.sendMessage = (id, message) =>
      id === 7 && message.type === MessageType.PING
        ? new Promise((resolve) => {
            releaseOld = () => resolve({ ok: true, url: "https://chatgpt.com/c/one", title: "One" });
          })
        : originalSend(id, message);
    const first = pinTab(7);
    for (let i = 0; i < 5 && !releaseOld; i += 1) await Promise.resolve();
    assert.ok(releaseOld);
    assert.equal((await pinTab(8)).tabId, 8);
    releaseOld();
    assert.equal(await first, null);
    assert.equal(fake.state.sessionData.pinnedAiTab.tabId, 8);
  } finally {
    chrome.tabs.sendMessage = originalSend;
    fake.restore();
  }
});

test("paused badge overrides turn and survives service-worker startup", async () => {
  const fake = installFakeChrome({ storage: { settings: { paused: true } } });
  try {
    // Re-evaluating the service worker models a stopped/restarted MV3 worker.
    await import(`../src/background/index.js?restart=${Date.now()}`);
    await pause(200);
    assert.equal(fake.state.badge.text, "OFF");
    assert.match(fake.state.badge.title, /paused/i);
    fake.chrome.__emit("focus", 1);
    fake.emitRuntimeMessage({ type: "GAME_STATE_CHANGED", gameState: { turn: "w", check: true, plyCount: 5 } });
    await pause(200);
    assert.equal(fake.state.badge.text, "OFF", "OFF wins over W, B, ! and AI");
    fake.state.badge.text = "";
    await import(`../src/background/index.js?restart=${Date.now() + 1}`);
    await pause(200);
    assert.equal(fake.state.badge.text, "OFF", "restart reads persistent pause before reporting the badge");
  } finally {
    fake.restore();
  }
});

test("a paused content script stays injected but refuses sends and disconnects its observer", async () => {
  const dom = installFakeDom();
  const fake = installFakeChrome({ storage: { settings: { paused: true } } });
  try {
    FakeMutationObserver.takeAll();
    const { start } = await import("../src/content/main.js");
    assert.equal(start(), true);
    assert.equal(start(), false, "re-injection does not register duplicate listeners");
    const pong = await fake.dispatchMessage({ type: MessageType.PING });
    assert.equal(pong.title, "Chess chat");
    const result = await fake.dispatchMessage({
      type: MessageType.SEND_CHESS_PROMPT,
      prompt: "Chess move request.",
      requestId: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.paused, true);
    assert.equal(FakeMutationObserver.created.length, 0, "observer never starts while paused");
    assert.equal(globalThis.__AI_CHESS_COMPANION_STARTED__, true);
  } finally {
    delete globalThis.__AI_CHESS_COMPANION_STARTED__;
    dom.restore();
    fake.restore();
  }
});

test("manual mode copies without touching composer, buttons or Enter; pause stops its watcher", async () => {
  const dom = installFakeDom();
  const fake = installFakeChrome({ storage: { settings: { sendMode: "manual" } } });
  try {
    FakeMutationObserver.takeAll();
    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    const input = dom.document.createElement("textarea", { selectors: ["textarea"] });
    dom.document.register(input, input.selectorMatches);
    container.append(input);
    const send = dom.document.createElement("button", { selectors: ["button[aria-label*='Send' i]"] });
    send.setAttribute("aria-label", "Send message");
    send.addEventListener("click", () => {
      send.clicked = true;
    });
    dom.document.register(send, send.selectorMatches);
    container.append(send);
    const { start } = await import("../src/content/main.js");
    assert.equal(start(), true);
    const result = await fake.dispatchMessage({
      type: MessageType.SEND_CHESS_PROMPT,
      prompt: "Full chess prompt",
      requestId: 7,
    });
    assert.equal(result.ok, true);
    assert.equal(result.manual, true);
    assert.equal(dom.document.lastCopiedText, "Full chess prompt");
    assert.equal(input.value, "");
    assert.equal(send.clicked, undefined);
    assert.equal(
      input.dispatched.some((event) => event.key === "Enter"),
      false,
    );
    const watcher = FakeMutationObserver.created.at(-1);
    assert.equal(watcher.disconnected, false);
    await fake.chrome.storage.local.set({ settings: { sendMode: "manual", paused: true } });
    assert.equal(watcher.disconnected, true, "pause disconnects the actual MutationObserver");
    const blocked = await fake.dispatchMessage({ type: MessageType.SEND_CHESS_PROMPT, prompt: "Next", requestId: 8 });
    assert.equal(blocked.paused, true);
  } finally {
    delete globalThis.__AI_CHESS_COMPANION_STARTED__;
    dom.restore();
    fake.restore();
  }
});
