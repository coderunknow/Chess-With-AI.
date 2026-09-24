/** Promise-based Chrome API double for the panel and service-worker tests. */

import { platformForUrl } from "../../src/shared/platforms.js";

export function installFakeChrome({
  storage = {},
  activeTab = { tabId: 7, supported: true, url: "https://chatgpt.com/c/1" },
  tabs = activeTab ? [{ id: activeTab.tabId, url: activeTab.url, titleFromContent: "Chess chat" }] : [],
  pin = activeTab?.supported
    ? {
        tabId: activeTab.tabId,
        url: activeTab.url,
        platformId: platformForUrl(activeTab.url)?.id || "",
        title: "Chess chat",
      }
    : null,
} = {}) {
  const previous = globalThis.chrome;
  const listeners = new Map();
  const state = {
    tabMessages: [],
    runtimeMessages: [],
    writes: [],
    storageData: { ...storage },
    sessionData: pin ? { pinnedAiTab: pin } : {},
    injectedFiles: [],
    tabReply: { move: null, failure: null },
    activeTab,
    tabs,
    badge: { text: "", title: "", color: "" },
  };
  const event = (type) => ({
    addListener(handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    removeListener(handler) {
      listeners.set(
        type,
        (listeners.get(type) || []).filter((entry) => entry !== handler),
      );
    },
  });
  const emit = (type, message, sender = { id: "test" }) => {
    for (const handler of listeners.get(type) || []) handler(message, sender, () => undefined);
  };
  const dispatchMessage = (message, sender = { id: "test" }) =>
    new Promise((resolve) => {
      let replied = false;
      const respond = (value) => {
        if (!replied) {
          replied = true;
          resolve(value);
        }
      };
      for (const handler of listeners.get("runtime") || []) handler(message, sender, respond);
      if (!replied && (listeners.get("runtime") || []).length === 0) resolve(undefined);
    });
  const pinRecord = () => state.sessionData.pinnedAiTab ?? state.storageData.pinnedAiTab ?? null;
  const livePin = () => {
    const pin = pinRecord();
    const tab = state.tabs.find((entry) => entry.id === pin?.tabId);
    const platform = platformForUrl(tab?.url);
    if (!pin || !platform || platform.id !== pin.platformId) {
      if (pin) {
        delete state.sessionData.pinnedAiTab;
        delete state.storageData.pinnedAiTab;
      }
      return null;
    }
    return { ...pin, url: tab.url, title: tab.titleFromContent ?? pin.title };
  };
  const storageArea = (target, area) => ({
    get: async (key) => (Object.hasOwn(target, key) ? { [key]: target[key] } : {}),
    set: async (values) => {
      for (const [key, value] of Object.entries(values)) {
        const oldValue = target[key];
        target[key] = value;
        state.writes.push({ key, value, area });
        emit("storage", { [key]: { oldValue, newValue: value } }, area);
      }
    },
    remove: async (key) => {
      const oldValue = target[key];
      delete target[key];
      emit("storage", { [key]: { oldValue, newValue: undefined } }, area);
    },
  });
  const chrome = {
    runtime: {
      id: "test-extension",
      lastError: undefined,
      onMessage: event("runtime"),
      onInstalled: event("installed"),
      onStartup: event("startup"),
      sendMessage: async (message) => {
        state.runtimeMessages.push(message);
        switch (message?.type) {
          case "GET_ACTIVE_TAB": {
            const pin = livePin();
            return pin
              ? {
                  ok: true,
                  supported: true,
                  tabId: pin.tabId,
                  url: pin.url,
                  platform: pin.platformId,
                  title: pin.title,
                  pinned: true,
                }
              : { ok: true, supported: false, tabId: null };
          }
          case "GET_CONNECTIONS":
            return {
              ok: true,
              pin: livePin(),
              tabs: state.tabs
                .filter((tab) => platformForUrl(tab.url))
                .map((tab) => ({
                  tabId: tab.id,
                  url: tab.url,
                  platformId: platformForUrl(tab.url).id,
                  platform: platformForUrl(tab.url).name,
                  host: new URL(tab.url).host,
                  title: tab.titleFromContent || "",
                })),
            };
          case "PIN_TAB": {
            const tab = state.tabs.find((entry) => entry.id === message.tabId);
            const platform = platformForUrl(tab?.url);
            if (!platform) return { ok: false };
            state.sessionData.pinnedAiTab = {
              tabId: tab.id,
              url: tab.url,
              platformId: platform.id,
              title: tab.titleFromContent || "",
            };
            return { ok: true, pin: state.sessionData.pinnedAiTab };
          }
          case "UNPIN_TAB":
            delete state.sessionData.pinnedAiTab;
            return { ok: true };
          default:
            return undefined;
        }
      },
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    tabs: {
      query: async (query = {}) =>
        query.active
          ? state.activeTab
            ? state.tabs.filter((tab) => tab.id === state.activeTab.tabId)
            : []
          : state.tabs.filter((tab) => platformForUrl(tab.url)),
      get: async (tabId) => {
        const tab = state.tabs.find((entry) => entry.id === tabId);
        if (!tab) throw new Error("No tab with id " + tabId);
        return tab;
      },
      create: async () => ({ id: 99 }),
      reload: async () => undefined,
      sendMessage: async (tabId, message) => {
        state.tabMessages.push({ tabId, message });
        if (state.tabReply.failure) throw new Error(state.tabReply.failure);
        if (message?.type === "PING") {
          const tab = state.tabs.find((entry) => entry.id === tabId);
          return {
            ok: true,
            url: tab?.url,
            title: tab?.titleFromContent || "",
            platform: platformForUrl(tab?.url)?.id || "",
          };
        }
        if (message?.type === "GET_DIAGNOSTICS") return { ok: true };
        if (message?.type === "SEND_CHESS_PROMPT") {
          if (state.storageData.settings?.paused) return { ok: false, paused: true, error: "Paused" };
          if (state.storageData.settings?.sendMode === "manual")
            return { ok: true, method: "manual", manual: true, copied: true };
        }
        return { ok: true, method: "button" };
      },
      onActivated: event("activated"),
      onUpdated: event("updated"),
      onRemoved: event("removed"),
    },
    scripting: {
      executeScript: async ({ files }) => {
        state.injectedFiles.push(...files);
        return [];
      },
    },
    storage: {
      local: storageArea(state.storageData, "local"),
      session: storageArea(state.sessionData, "session"),
      onChanged: event("storage"),
    },
    sidePanel: {
      setOptions: async () => undefined,
      setPanelBehavior: async () => undefined,
    },
    action: {
      setBadgeText: async ({ text }) => {
        state.badge.text = text;
      },
      setBadgeBackgroundColor: async ({ color }) => {
        state.badge.color = color;
      },
      setTitle: async ({ title }) => {
        state.badge.title = title;
      },
    },
    windows: { onFocusChanged: event("focus") },
  };
  globalThis.chrome = /** @type {typeof chrome} */ (chrome);
  return {
    chrome: { ...chrome, __emit: emit, __state: state },
    state,
    emitRuntimeMessage: (message, sender) => emit("runtime", message, sender),
    dispatchMessage,
    restore() {
      globalThis.chrome = previous;
    },
  };
}
