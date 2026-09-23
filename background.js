const AI_HOSTS = new Set([
  "gemini.google.com",
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "grok.com",
  "www.perplexity.ai",
  "copilot.microsoft.com"
]);

function isSupportedAiUrl(url) {
  try {
    return AI_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function configurePanelForTab(tabId, url) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: isSupportedAiUrl(url)
    });
  } catch (error) {
    console.warn("AI Chess Companion could not configure the side panel.", error);
  }
}

async function configureCurrentTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await configurePanelForTab(tabId, tab.url);
  } catch (error) {
    console.warn("AI Chess Companion could not read the active tab.", error);
  }
}

async function configurePanelBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("AI Chess Companion could not configure panel behavior.", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  configurePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  configurePanelBehavior();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    configurePanelForTab(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  configureCurrentTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "GET_ACTIVE_TAB") {
    return false;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true })
    .then((tabs) => {
      const tab = tabs[0];
      sendResponse(tab ? { ok: true, tabId: tab.id, url: tab.url || "" } : { ok: false });
    })
    .catch(() => sendResponse({ ok: false }));

  return true;
});
