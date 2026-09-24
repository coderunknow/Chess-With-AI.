/** MV3 service worker: pin, picker, pause badge and side-panel behaviour. */

import { createLogger } from "../shared/log.js";
import { MessageType, isExtensionMessage } from "../shared/messaging.js";
import { DEFAULT_SETTINGS, SETTINGS_KEY, normaliseSettings } from "../shared/settings.js";
import { readValue, writeValue } from "../shared/storage.js";
import { clearPin, listSupportedTabs, pinTab, resolvePin } from "./pin.js";
import { configureSidePanel, getPinnedConnection, setBadgePaused, trackActiveTab, updateBadge } from "./panel.js";

const log = createLogger("background");

chrome.runtime.onInstalled.addListener((details) => {
  log.info(`installed (${details.reason})`);
  void initialise();
});
chrome.runtime.onStartup.addListener(() => void initialise());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;
  const reply = async () => {
    switch (message.type) {
      case MessageType.GET_ACTIVE_TAB:
        return { ok: true, ...(await getPinnedConnection()) };
      case MessageType.GET_CONNECTIONS:
        return { ok: true, pin: await resolvePin(), tabs: await listSupportedTabs() };
      case MessageType.PIN_TAB: {
        const pin = await pinTab(message.tabId);
        if (!pin) return { ok: false, error: "Unsupported or closed AI tab." };
        await updateBadge({ supported: true, platform: pin.platformId, tabId: pin.tabId, url: pin.url });
        return { ok: true, pin };
      }
      case MessageType.UNPIN_TAB:
        await clearPin("unpin");
        await updateBadge(null);
        return { ok: true };
      case MessageType.PAUSE_CHANGED: {
        const settings = normaliseSettings(await readValue(SETTINGS_KEY, DEFAULT_SETTINGS));
        setBadgePaused(settings.paused, settings.locale);
        return { ok: true, paused: settings.paused };
      }
      default:
        return null;
    }
  };
  if (
    ![
      MessageType.GET_ACTIVE_TAB,
      MessageType.GET_CONNECTIONS,
      MessageType.PIN_TAB,
      MessageType.UNPIN_TAB,
      MessageType.PAUSE_CHANGED,
    ].includes(message.type)
  )
    return false;
  reply()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || "Connection unavailable." }));
  return true;
});

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) {
    const settings = normaliseSettings(changes[SETTINGS_KEY].newValue);
    setBadgePaused(settings.paused, settings.locale);
  }
});

trackActiveTab();

async function initialise() {
  const stored = await readValue(SETTINGS_KEY, null);
  if (stored === null) await writeValue(SETTINGS_KEY, DEFAULT_SETTINGS);
  const settings = normaliseSettings(stored || DEFAULT_SETTINGS);
  setBadgePaused(settings.paused, settings.locale);
  await configureSidePanel();
}

void initialise();
