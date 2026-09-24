/**
 * One supported AI tab is explicitly pinned. Host permissions (not `tabs`)
 * allow querying the declared hosts; the content script supplies document.title.
 * The session storage area survives service-worker restarts, with local fallback.
 *
 * @module background/pin
 */

import { HOST_PATTERNS, platformForUrl } from "../shared/platforms.js";
import { MessageType, createMessage } from "../shared/messaging.js";

export const PIN_KEY = "pinnedAiTab";

// Explicit pin/unpin and a delayed tab-validation result must never race to
// overwrite each other. This lives in the MV3 worker; storage remains the
// authority after a worker restart.
let pinEpoch = 0;
let pendingPinTabId = null;
let writes = Promise.resolve();
function clearPendingIntent() {
  pendingPinTabId = null;
}
function enqueueWrite(action) {
  const pending = writes.then(action, action);
  writes = pending.catch(() => undefined);
  return pending;
}

function storageArea() {
  return chrome.storage.session?.get ? chrome.storage.session : chrome.storage.local;
}

function validPin(value) {
  if (!value || !Number.isInteger(value.tabId) || value.tabId < 0) return null;
  const platform = platformForUrl(value.url);
  if (!platform || platform.id !== value.platformId) return null;
  return {
    tabId: value.tabId,
    url: value.url,
    platformId: platform.id,
    title: typeof value.title === "string" ? value.title.slice(0, 200) : "",
  };
}

export async function readPin() {
  try {
    const data = await storageArea().get(PIN_KEY);
    return validPin(data?.[PIN_KEY]);
  } catch {
    return null;
  }
}

export async function clearPin(reason = "unpin", expectedPin = null, expectedEpoch = pinEpoch) {
  // A closure/navigation detected for an OLD tab must not unpin a newer one,
  // even when the newer pin request is still waiting for a title/PING.
  const observedEpoch = pinEpoch;
  if (expectedPin) {
    if (pendingPinTabId !== null && pendingPinTabId !== expectedPin.tabId) return false;
    if (expectedEpoch !== pinEpoch) return false;
    const current = await readPin();
    if (observedEpoch !== pinEpoch || current?.tabId !== expectedPin.tabId) return false;
  }
  const epoch = ++pinEpoch;
  clearPendingIntent();
  return enqueueWrite(async () => {
    if (epoch !== pinEpoch || (expectedPin && (await readPin())?.tabId !== expectedPin.tabId)) return false;
    await storageArea().remove(PIN_KEY);
    try {
      await chrome.runtime.sendMessage(createMessage(MessageType.PIN_CHANGED, { pin: null, reason }));
    } catch {
      // Side panel may be closed.
    }
    return true;
  });
}

async function titleFromContent(tabId, url) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, createMessage(MessageType.PING));
    return pong?.ok && pong.url === url && typeof pong.title === "string" ? pong.title.trim().slice(0, 200) : "";
  } catch {
    return ""; // script not injected yet; the picker still identifies the tab
  }
}

/** Query only the declared AI hosts. Neither titles nor unsupported tabs leak. */
export async function listSupportedTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: HOST_PATTERNS });
  } catch {
    return [];
  }
  return Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id) && platformForUrl(tab.url))
      .map(async (tab) => {
        const platform = platformForUrl(tab.url);
        return {
          tabId: tab.id,
          url: tab.url,
          platformId: platform.id,
          platform: platform.name,
          host: new URL(tab.url).host,
          title: await titleFromContent(tab.id, tab.url),
        };
      }),
  );
}

/** Validate against a live tab, including navigation off the pinned host. */
export async function resolvePin({ notify = true } = {}) {
  await writes;
  const pin = await readPin();
  if (!pin) return null;
  // While an explicit selection is being validated, the old stored pin is no
  // longer a safe destination; do not clear it on an old tab-close event.
  if (pendingPinTabId !== null && pendingPinTabId !== pin.tabId) return null;
  const epoch = pinEpoch;
  let tab;
  try {
    tab = await chrome.tabs.get(pin.tabId);
  } catch {
    if (notify) await clearPin("closed", pin, epoch);
    return null;
  }
  const platform = platformForUrl(tab?.url);
  if (!platform || platform.id !== pin.platformId) {
    if (notify) await clearPin("navigated", pin, epoch);
    return null;
  }
  // A navigation within the same supported host stays in the same tab. Refresh
  // the stored URL/title, but never move the pin to a different tab ID.
  const title = await titleFromContent(pin.tabId, tab.url);
  if (epoch !== pinEpoch) return readPin();
  const updated = { ...pin, url: tab.url, title: title || (tab.url === pin.url ? pin.title : "") };
  if (updated.url !== pin.url || updated.title !== pin.title) {
    await enqueueWrite(async () => {
      if (epoch !== pinEpoch || (await readPin())?.tabId !== pin.tabId) return;
      await storageArea().set({ [PIN_KEY]: updated });
    });
  }
  return epoch === pinEpoch ? updated : readPin();
}

export async function pinTab(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  const epoch = ++pinEpoch;
  pendingPinTabId = tabId;
  try {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
    const platform = platformForUrl(tab?.url);
    if (!platform || epoch !== pinEpoch) return null;
    const pin = {
      tabId,
      url: tab.url,
      platformId: platform.id,
      title: await titleFromContent(tabId, tab.url),
    };
    if (epoch !== pinEpoch) return null;
    return await enqueueWrite(async () => {
      if (epoch !== pinEpoch) return null;
      await storageArea().set({ [PIN_KEY]: pin });
      if (epoch !== pinEpoch) return null;
      try {
        await chrome.runtime.sendMessage(createMessage(MessageType.PIN_CHANGED, { pin, reason: "pinned" }));
      } catch {
        // Side panel may be closed.
      }
      return pin;
    });
  } finally {
    if (epoch === pinEpoch) pendingPinTabId = null;
  }
}
