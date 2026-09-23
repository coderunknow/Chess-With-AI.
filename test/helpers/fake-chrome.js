/**
 * Chrome extension API double.
 *
 * Records every call so tests can assert on the messages the extension would
 * have sent, and lets a test script the replies of the AI tab.
 *
 * @module test/helpers/fake-chrome
 */

/**
 * @typedef {object} FakeChromeState
 * @property {Array<{tabId: number, message: object}>} tabMessages
 * @property {Array<object>} runtimeMessages
 * @property {Array<{key: string, value: unknown}>} writes
 * @property {Record<string, unknown>} storageData
 * @property {Array<string>} injectedFiles
 * @property {{move: string|null, failure: string|null}} tabReply
 * @property {object|null} activeTab
 */

/**
 * Installs a `chrome` double on `globalThis`.
 *
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.storage]
 * @param {{tabId?: number, supported?: boolean, url?: string}} [options.activeTab]
 * @returns {{chrome: object, state: FakeChromeState, restore: () => void}}
 */
export function installFakeChrome({
  storage = {},
  activeTab = { tabId: 7, supported: true, url: "https://chatgpt.com/c/1" },
} = {}) {
  const previous = globalThis.chrome;
  const listeners = new Map();

  /** @type {FakeChromeState} */
  const state = {
    tabMessages: [],
    runtimeMessages: [],
    writes: [],
    storageData: { ...storage },
    injectedFiles: [],
    tabReply: { move: null, failure: null },
    activeTab,
  };

  /**
   * @param {string} type
   * @param {object} message
   */
  const emit = (type, message) => {
    for (const handler of listeners.get(type) || []) {
      handler(message, { id: "test" }, () => undefined);
    }
  };

  const chrome = {
    runtime: {
      id: "test-extension",
      lastError: undefined,
      onMessage: {
        addListener: (handler) => {
          const handlers = listeners.get("runtime") || [];
          handlers.push(handler);
          listeners.set("runtime", handlers);
        },
        removeListener: () => undefined,
      },
      onInstalled: { addListener: () => undefined },
      onStartup: { addListener: () => undefined },
      sendMessage: async (message) => {
        state.runtimeMessages.push(message);
        if (message?.type === "GET_ACTIVE_TAB") {
          return state.activeTab
            ? { ok: true, tabId: state.activeTab.tabId, url: state.activeTab.url, supported: state.activeTab.supported }
            : { ok: false, supported: false };
        }
        return undefined;
      },
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    tabs: {
      query: async () => (state.activeTab ? [{ id: state.activeTab.tabId, url: state.activeTab.url }] : []),
      get: async (tabId) => ({ id: tabId, url: state.activeTab?.url }),
      create: async () => ({ id: 99 }),
      sendMessage: async (tabId, message) => {
        state.tabMessages.push({ tabId, message });
        if (state.tabReply.failure) {
          throw new Error(state.tabReply.failure);
        }
        return { ok: true, method: state.tabReply.move ? "button" : "button" };
      },
      onActivated: { addListener: () => undefined, removeListener: () => undefined },
      onUpdated: { addListener: () => undefined, removeListener: () => undefined },
      onRemoved: { addListener: () => undefined, removeListener: () => undefined },
    },
    scripting: {
      executeScript: async ({ files }) => {
        state.injectedFiles.push(...files);
        return [];
      },
    },
    storage: {
      local: {
        get: async (key) => (Object.hasOwn(state.storageData, key) ? { [key]: state.storageData[key] } : {}),
        set: async (values) => {
          for (const [key, value] of Object.entries(values)) {
            state.storageData[key] = value;
            state.writes.push({ key, value });
          }
        },
        remove: async (key) => {
          delete state.storageData[key];
        },
      },
    },
    sidePanel: {
      setOptions: async () => undefined,
      setPanelBehavior: async () => undefined,
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
      setTitle: async () => undefined,
    },
    windows: {
      onFocusChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  };

  globalThis.chrome = /** @type {typeof chrome} */ (chrome);

  return {
    chrome: { ...chrome, __emit: emit, __state: state },
    state,
    /** @param {object} message */
    emitRuntimeMessage: (message) => emit("runtime", message),
    restore() {
      globalThis.chrome = previous;
    },
  };
}
