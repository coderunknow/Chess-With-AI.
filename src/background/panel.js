/**
 * Side-panel lifecycle and toolbar badge. A pin, not the focused window,
 * determines the chat destination. Pause takes precedence over every badge.
 *
 * @module background/panel
 */

import { createLogger } from "../shared/log.js";
import { platformForUrl } from "../shared/platforms.js";
import { createTranslator } from "../shared/i18n.js";
import { resolveLocale } from "../shared/settings.js";
import { readPin, resolvePin } from "./pin.js";

const log = createLogger("panel");
export const SIDE_PANEL_PATH = "sidepanel.html";
const BADGE_SUPPORTED = "AI";
const BADGE_COLOR = "#2f7d5a";
const BADGE_COLOR_WHITE = "#4a90d9";
const BADGE_COLOR_BLACK = "#2f2f2f";
const BADGE_COLOR_CHECK = "#d32f2f";

let lastDescription = null;
let lastGameState = null;
let paused = false;
let t = createTranslator("en");

export async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true });
  } catch (error) {
    log.warn("could not configure side panel", error);
  }
}

export function describeTab(tab) {
  const url = tab?.url || "";
  const platform = platformForUrl(url);
  return {
    tabId: Number.isInteger(tab?.id) ? tab.id : null,
    url,
    platform: platform?.id || "",
    supported: Boolean(platform),
  };
}

/** Retained for diagnostics/tests; never used to address a prompt. */
export async function getActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return describeTab(tabs[0]);
  } catch (error) {
    log.warn("could not read active tab", error);
    return null;
  }
}

export async function getPinnedConnection({ slot = undefined } = {}) {
  const pin = await resolvePin({ ...(slot ? { slot } : {}) });
  if (!pin) return { supported: false, tabId: null, url: "", platform: "", title: "" };
  return { supported: true, tabId: pin.tabId, url: pin.url, platform: pin.platformId, title: pin.title, pinned: true };
}

export function setBadgePaused(next, locale = "en") {
  paused = Boolean(next);
  t = createTranslator(resolveLocale(locale));
  void updateBadge(lastDescription, lastGameState);
}

export async function updateBadge(description, gameState = null) {
  lastDescription = description;
  if (gameState) lastGameState = gameState;
  const state = gameState || lastGameState;
  try {
    if (paused) {
      await chrome.action.setBadgeText({ text: "OFF" });
      await chrome.action.setBadgeBackgroundColor({ color: "#696f79" });
      await chrome.action.setTitle({ title: t("badge.paused") });
      return;
    }
    if (!description?.supported) {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: t("badge.pin") });
      return;
    }

    let badgeText = BADGE_SUPPORTED;
    let badgeColor = BADGE_COLOR;
    let title = t("badge.pinned", { platform: description.platform });
    if (state && !state.over && state.plyCount > 0) {
      if (state.check) {
        badgeText = "!";
        badgeColor = BADGE_COLOR_CHECK;
        title = t("badge.check", { color: t(state.turn === "w" ? "clock.white" : "clock.black") });
      } else if (state.turn === "w") {
        badgeText = "W";
        badgeColor = BADGE_COLOR_WHITE;
        title = t("badge.white");
      } else if (state.turn === "b") {
        badgeText = "B";
        badgeColor = BADGE_COLOR_BLACK;
        title = t("badge.black");
      }
    }
    await chrome.action.setBadgeText({ text: badgeText });
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    await chrome.action.setTitle({ title });
  } catch (error) {
    log.debug("badge update skipped", error);
  }
}

export async function broadcastActiveTab(description) {
  try {
    await chrome.runtime.sendMessage({ type: "ACTIVE_TAB_CHANGED", ...(description || { supported: false }) });
  } catch {
    // No panel is listening.
  }
}

/** Tab events validate the pin, but focus changes never reassign it. */
export function trackActiveTab({ debounceMs = 150 } = {}) {
  let timer = 0;
  const refresh = async () => {
    const pin = await resolvePin();
    const description = pin
      ? { supported: true, tabId: pin.tabId, url: pin.url, platform: pin.platformId, title: pin.title }
      : null;
    await updateBadge(description, lastGameState);
    // The pin service broadcasts PIN_CHANGED only on explicit pin/loss;
    // never tell the panel to follow an active tab after losing the pin.
  };
  const schedule = () => {
    globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(
      () => void refresh().catch((error) => log.debug("refresh skipped", error)),
      debounceMs,
    );
  };
  const onActivated = () => {
    // A focus change cannot change the connection. If unpinned the badge is
    // empty; the picker, not a window, is the only way to choose a chat.
  };
  const onUpdated = (tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      void readPin().then((pin) => {
        if (pin?.tabId === tabId) schedule();
      });
    }
  };
  const onRemoved = (tabId) => {
    void readPin().then((pin) => {
      if (pin?.tabId === tabId) schedule();
    });
  };
  const onFocus = () => {}; // intentionally inert while pinned
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  chrome.windows?.onFocusChanged?.addListener(onFocus);

  const onMessage = (message) => {
    if (message?.type === "GAME_STATE_CHANGED" && message.gameState) {
      lastGameState = message.gameState;
      void updateBadge(lastDescription, lastGameState);
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  schedule();

  return () => {
    globalThis.clearTimeout(timer);
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    chrome.windows?.onFocusChanged?.removeListener(onFocus);
    chrome.runtime.onMessage.removeListener(onMessage);
  };
}
