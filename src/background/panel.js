/**
 * Side-panel lifecycle and active-tab tracking — v2 with badge turn/check sync.
 *
 * The panel is available on every page (so the board, history and PGN tools can
 * always be opened) while the content script only ever runs on supported AI
 * hosts. The active tab is reported to the panel so it knows where to send
 * prompts; the toolbar badge shows when a usable AI chat is in front and now
 * reflects turn/check.
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
const BADGE_COLOR_WHITE = "#4a90d9";
const BADGE_COLOR_BLACK = "#2f2f2f";
const BADGE_COLOR_CHECK = "#d32f2f";

/** @type {{tabId:number|null, url:string, platform:string, supported:boolean, turn?:string, check?:boolean, over?:boolean}} */
let lastDescription = null;
let lastGameState = null;

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
 * Updates the toolbar badge for the given tab description and optional game state.
 *
 * Badge logic v2:
 * - No supported tab: empty
 * - Supported, no game or game over: "AI"
 * - Supported, game in progress: "W" white to move, "B" black to move, "!" if check (red)
 *
 * @param {ReturnType<typeof describeTab>|null} description
 * @param {{turn?:string, check?:boolean, over?:boolean, plyCount?:number}|null} gameState
 */
export async function updateBadge(description, gameState = null) {
  lastDescription = description;
  if (gameState) {
    lastGameState = gameState;
  }

  try {
    if (!description?.supported) {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "AI Chess Companion — open an AI chat tab to play" });
      return;
    }

    let badgeText = BADGE_SUPPORTED;
    let badgeColor = BADGE_COLOR;
    let title = `AI Chess Companion — connected to ${description.platform}`;

    if (gameState && !gameState.over && gameState.plyCount > 0) {
      if (gameState.check) {
        badgeText = "!";
        badgeColor = BADGE_COLOR_CHECK;
        title = `AI Chess Companion — ${gameState.turn === "w" ? "White" : "Black"} is in check on ${description.platform}`;
      } else if (gameState.turn === "w") {
        badgeText = "W";
        badgeColor = BADGE_COLOR_WHITE;
        title = `AI Chess Companion — White to move on ${description.platform}`;
      } else if (gameState.turn === "b") {
        badgeText = "B";
        badgeColor = BADGE_COLOR_BLACK;
        title = `AI Chess Companion — Black to move on ${description.platform}`;
      }
    }

    await chrome.action.setBadgeText({ text: badgeText });
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    await chrome.action.setTitle({ title });
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
    await Promise.all([updateBadge(description, lastGameState), broadcastActiveTab(description)]);
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

  // Listen for game state updates from side panel
  const onMessage = (message) => {
    if (message?.type === "GAME_STATE_CHANGED" && message.gameState) {
      lastGameState = message.gameState;
      if (lastDescription) {
        void updateBadge(lastDescription, lastGameState);
      }
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  return () => {
    globalThis.clearTimeout(timer);
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    chrome.windows?.onFocusChanged?.removeListener(() => schedule(null));
    chrome.runtime.onMessage.removeListener(onMessage);
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
