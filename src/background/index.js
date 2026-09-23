/**
 * Extension service worker (Manifest V3, ES module).
 *
 * Kept intentionally thin: it owns the side-panel behaviour, keeps the toolbar
 * badge truthful, and answers the panel's `GET_ACTIVE_TAB` question. All chess
 * logic lives in the side panel; all page interaction lives in the content
 * script.
 *
 * @module background
 */

import { createLogger } from "../shared/log.js";
import { MessageType, isExtensionMessage } from "../shared/messaging.js";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../shared/settings.js";
import { readValue, writeValue } from "../shared/storage.js";
import { configureSidePanel, getActiveTab, trackActiveTab } from "./panel.js";

const log = createLogger("background");

// Listeners are registered synchronously so events are never missed if the
// worker is stopped and restarted by the browser.
chrome.runtime.onInstalled.addListener((details) => {
  log.info(`installed (${details.reason})`);
  void initialise();
});

chrome.runtime.onStartup.addListener(() => {
  void initialise();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionMessage(message) || message.type !== MessageType.GET_ACTIVE_TAB) {
    return false;
  }

  getActiveTab()
    .then((description) => sendResponse({ ok: Boolean(description), ...(description || {}) }))
    .catch(() => sendResponse({ ok: false, supported: false }));

  return true;
});

trackActiveTab();

/**
 * Applies the panel behaviour once and seeds default settings on first run.
 *
 * @returns {Promise<void>}
 */
async function initialise() {
  await configureSidePanel();

  const stored = await readValue(SETTINGS_KEY, null);
  if (stored === null) {
    await writeValue(SETTINGS_KEY, DEFAULT_SETTINGS);
  }
}

void initialise();
