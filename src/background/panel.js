/**
 * Side-panel lifecycle and active-tab tracking.
 *
 * The panel is available on every page (so the board, history and PGN tools can
 * always be opened) while the content script only ever runs on supported AI
 * hosts. The active tab is reported to the panel so it knows where to send
 * prompts; the toolbar badge shows when a usable AI chat is in front.
 *
 * @module background/panel
 */

import { createLogger } from "../shared/log.js";
import { platformForUrl } from "../shared/platforms.js";

const log = createLogger("panel");

/** Path of the side panel document. */
export const SIDE_PANEL_PATH = "sidepanel.html";

/** Badge shown while a supported AI chat is the active tab. */
const BADGE_SUPPORTED = "AI";
const BADGE_COLOR = "#2f7d5a";

/**
 * Applies the panel behaviour. Safe to call repeatedly; every failure is logged
 * and swallowed because a missing side panel must never break the worker.
 *
 * @returns {Promise<void>}
 */
export async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    log.warn("could not enable open-on-action-click", error);
  }

  try {
    await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true });
  } catch (error) {
    log.warn("could not configure the side panel path", error);
  }
}

/**
 * @param {chrome.tabs.Tab|undefined} tab
 * @returns {{tabId: number|null, url: string, platform: string, supported: boolean}}
 */
export function describeTab(tab) {
  const url = tab?.url || "";
  const platform = platformForUrl(url);
  return {
    tabId: Number.isInteger(tab?.id) ? /** @type {number} */ (tab.id) : null,
    url,
    platform: platform?.id || "",
    supported: Boolean(platform),
  };
}

/**
 * @returns {Promise<ReturnType<typeof describeTab>|null>} the active tab of the
 *   last focused window, or null when it cannot be read.
 */
export async function getActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return describeTab(tabs[0]);
  } catch (error) {
    log.warn("could not read the active tab", error);
    return null;
  }
}

/**
 * Updates the toolbar badge for the given tab description.
 *
 * @param {ReturnType<typeof describeTab>|null} description
 */
export async function updateBadge(description) {
  try {
    await chrome.action.setBadgeText({ text: description?.supported ? BADGE_SUPPORTED : "" });
    if (description?.supported) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      await chrome.action.setTitle({ title: `AI Chess Companion — connected to ${description.platform}` });
      return;
    }
    await chrome.action.setTitle({ title: "AI Chess Companion — open an AI chat tab to play" });
  } catch (error) {
    log.debug("badge update skipped", error);
  }
}

/**
 * Sends the active-tab description to the side panel (ignored when closed).
 *
 * @param {ReturnType<typeof describeTab>|null} description
 */
export async function broadcastActiveTab(description) {
  try {
    await chrome.runtime.sendMessage({ type: "ACTIVE_TAB_CHANGED", ...(description || { supported: false }) });
  } catch {
    // No panel is listening; nothing to do.
  }
}

/**
 * Installs tab listeners that keep the badge and the panel in sync.
 *
 * Timers use `globalThis` because a service worker has no `window`.
 *
 * @param {object} [options]
 * @param {number} [options.debounceMs] coalescing window for rapid tab events.
 * @returns {() => void} an unsubscribe function (used by tests).
 */
export function trackActiveTab({ debounceMs = 150 } = {}) {
  let timer = 0;
  let lastTabId = null;

  const refresh = async (tabId = null) => {
    const description = tabId === null ? await getActiveTab() : describeTab(await safeGetTab(tabId));
    if (description?.tabId !== null) {
      lastTabId = description.tabId;
    }
    await Promise.all([updateBadge(description), broadcastActiveTab(description)]);
  };

  const schedule = (tabId = null) => {
    globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => {
      refresh(tabId).catch((error) => log.debug("refresh skipped", error));
    }, debounceMs);
  };

  const onActivated = ({ tabId }) => schedule(tabId);
  const onUpdated = (tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      schedule(tabId);
    }
  };
  const onRemoved = (tabId) => {
    if (tabId === lastTabId) {
      lastTabId = null;
      schedule(null);
    }
  };

  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  chrome.windows?.onFocusChanged?.addListener(() => schedule(null));

  return () => {
    globalThis.clearTimeout(timer);
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    chrome.windows?.onFocusChanged?.removeListener(() => schedule(null));
  };
}

/**
 * @param {number} tabId
 * @returns {Promise<chrome.tabs.Tab|undefined>} the tab, or undefined.
 */
async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}
