/**
 * Content script entry. The bridge sends once; the watcher is armed only for a
 * new request and never rescans history after pause or a worker restart.
 *
 * @module content/main
 */

import { createLogger } from "../shared/log.js";
import { DiagnosticsCollector, formatReport } from "../shared/diagnostics.js";
import {
  MAX_PROMPT_LENGTH,
  MessageType,
  createMessage,
  describeRuntimeError,
  isExtensionMessage,
  sanitisePrompt,
} from "../shared/messaging.js";
import { DEFAULT_SETTINGS, SETTINGS_KEY, normaliseSettings } from "../shared/settings.js";
import { readValue } from "../shared/storage.js";
import {
  assistantCandidatesForHost,
  assistantSelectorsForHost,
  platformForHost,
  userSelectorsForHost,
} from "../shared/platforms.js";
import { ChatBridge } from "./bridge.js";
import { MoveWatcher } from "./observer.js";

const log = createLogger("content");

const STATUS = Object.freeze({
  READY: "ready",
  PROMPT_SENT: "prompt-sent",
  GENERATION_WAIT: "generation-wait",
  MANUAL: "manual",
  ERROR: "error",
  NO_MOVE: "no-move",
});

function notifyPanel(payload) {
  try {
    chrome.runtime.sendMessage(createMessage(MessageType.CONTENT_STATUS, payload))?.catch?.(() => undefined);
  } catch (error) {
    log.debug("panel is not reachable", describeRuntimeError(error));
  }
}

export function start() {
  if (globalThis.__AI_CHESS_COMPANION_STARTED__) return false;
  globalThis.__AI_CHESS_COMPANION_STARTED__ = true;

  const platform = platformForHost(window.location.hostname);
  const diagnostics = new DiagnosticsCollector({ platform: platform?.id || "", url: window.location.href });
  const bridge = new ChatBridge({ diagnostics, hostname: window.location.hostname });
  let paused = false;
  let currentRequestId = null;
  let deliveryReady = false;
  let queuedReply = null;

  const deliver = (event) => {
    watcher.stop();
    const payload = {
      ...event,
      requestId: currentRequestId,
      platform: platform?.id || "",
      diagnostics: diagnostics.report,
    };
    if (event.noMove) {
      notifyPanel({ state: STATUS.NO_MOVE, ...payload });
    } else {
      chrome.runtime.sendMessage(createMessage(MessageType.AI_MOVE, payload))?.catch?.(() => undefined);
    }
  };

  const watcher = new MoveWatcher({
    assistantSelectors: () => assistantSelectorsForHost(window.location.hostname),
    assistantCandidates: () => assistantCandidatesForHost(window.location.hostname),
    userSelectors: userSelectorsForHost(window.location.hostname),
    diagnostics,
    onMove: (event) => {
      if (paused) return;
      if (deliveryReady) deliver(event);
      else queuedReply = event; // a fast reply during submit verification
    },
  });

  const setPaused = (next) => {
    paused = Boolean(next);
    if (paused) {
      watcher.stop();
      bridge.cancel();
      queuedReply = null;
      deliveryReady = false;
    }
  };

  // The persisted setting is consulted on each request as well. This listener
  // stops an already-running observer even if the panel closes in the meantime.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) {
      setPaused(normaliseSettings(changes[SETTINGS_KEY].newValue).paused);
    }
  });
  void readValue(SETTINGS_KEY, DEFAULT_SETTINGS).then((value) => setPaused(normaliseSettings(value).paused));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") diagnostics.setUrl(window.location.href);
  });
  window.addEventListener("beforeunload", () => watcher.stop());

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isExtensionMessage(message)) return false;

    if (message.type === MessageType.PING) {
      sendResponse({
        ok: true,
        platform: platform?.id || "",
        url: window.location.href,
        title: document.title || "",
        paused,
        diagnostics: diagnostics.report,
      });
      return false;
    }
    if (message.type === MessageType.SET_PAUSED) {
      setPaused(message.paused);
      sendResponse({ ok: true, paused });
      return false;
    }
    if (message.type === MessageType.CANCEL_REPLY) {
      watcher.stop();
      bridge.cancel(); // also abort a Stop/generation wait before it can submit
      queuedReply = null;
      deliveryReady = false;
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === MessageType.GET_DIAGNOSTICS) {
      sendResponse({ ok: true, report: diagnostics.report, formatted: formatReport(diagnostics.report) });
      return false;
    }
    if (message.type !== MessageType.SEND_CHESS_PROMPT) return false;

    // Read persistent pause every time: a newly injected script or a restarted
    // service worker must not be able to wake a paused connection.
    (async () => {
      const stored = normaliseSettings(await readValue(SETTINGS_KEY, DEFAULT_SETTINGS));
      setPaused(stored.paused);
      if (paused) {
        sendResponse({ ok: false, paused: true, error: "The companion is paused." });
        return;
      }
      const prompt = sanitisePrompt(message.prompt);
      if (!prompt || typeof message.prompt !== "string" || message.prompt.trim().length > MAX_PROMPT_LENGTH) {
        sendResponse({ ok: false, error: "The prompt is empty or exceeds the 4000-character limit." });
        return;
      }
      if (bridge.inFlight) {
        sendResponse({ ok: false, error: "A prompt is already being sent." });
        return;
      }
      // Even when manual mode is requested by the sender, the stored setting is
      // authoritative: messages cannot bypass it to click the page's controls.
      const manual = stored.sendMode === "manual";
      currentRequestId = message.requestId ?? null;
      queuedReply = null;
      deliveryReady = false;
      watcher.expectReply(prompt, { rejectedMoves: message.rejectedMoves || [], manual });
      if (manual) {
        let copied = false;
        try {
          await navigator.clipboard.writeText(prompt);
          copied = true;
        } catch {
          // A copy button in the panel remains available (user gesture).
        }
        if (paused) {
          watcher.stop();
          sendResponse({ ok: false, paused: true, error: "The companion is paused." });
          return;
        }
        deliveryReady = true; // watcher still waits for the user's full prompt echo
        notifyPanel({ state: STATUS.MANUAL, requestId: currentRequestId, platform: platform?.id || "" });
        sendResponse({ ok: true, method: "manual", manual: true, copied });
        return;
      }
      bridge.generationWaitMs = stored.generationWaitMs;
      const result = await bridge.send(prompt, {
        onSubmit: () => watcher.markSubmitted(),
        onStatus: (state) => {
          if (state === "generation-wait") {
            notifyPanel({ state: STATUS.GENERATION_WAIT, requestId: currentRequestId, platform: platform?.id || "" });
          }
        },
      });
      if (!result.ok || paused) {
        watcher.stop();
        queuedReply = null;
        let copied = false;
        if (result.result === "generation-timeout") {
          try {
            await navigator.clipboard.writeText(prompt);
            copied = true;
          } catch {
            // The panel provides a user-gesture Copy button if this is denied.
          }
        }
        notifyPanel({
          state: paused ? STATUS.ERROR : result.result,
          requestId: currentRequestId,
          error: paused ? "The companion is paused." : result.error,
          platform: platform?.id || "",
          diagnostics: result.diagnostics,
        });
        sendResponse({
          ok: false,
          paused,
          copied,
          error: paused ? "The companion is paused." : result.error,
          result: result.result,
          diagnostics: result.diagnostics,
        });
        return;
      }
      deliveryReady = true;
      notifyPanel({
        state: STATUS.PROMPT_SENT,
        requestId: currentRequestId,
        method: result.method,
        platform: platform?.id || "",
        diagnostics: result.diagnostics,
      });
      sendResponse({ ok: true, method: result.method, diagnostics: result.diagnostics });
      if (queuedReply) {
        const reply = queuedReply;
        queuedReply = null;
        deliver(reply);
      }
    })().catch((error) => {
      watcher.stop();
      log.error("sending the prompt failed", error);
      const detail = error?.message || "The chess prompt could not be sent.";
      notifyPanel({ state: STATUS.ERROR, error: detail, requestId: currentRequestId, platform: platform?.id || "" });
      sendResponse({ ok: false, error: detail });
    });
    return true;
  });

  notifyPanel({ state: STATUS.READY, platform: platform?.id || "", diagnostics: diagnostics.report });
  return true;
}

export { STATUS };
