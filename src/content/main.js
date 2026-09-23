/**
 * Content script entry point (ES module) — v2.
 *
 * Loaded by `index.js` through a dynamic `import()` because Manifest V3 does not
 * support `"type": "module"` for content scripts. Responsibilities:
 *
 *  1. answer `SEND_CHESS_PROMPT` messages from the side panel,
 *  2. watch the transcript for the AI's bracketed move and forward it,
 *  3. report its own state so the panel can explain what went wrong,
 *  4. provide diagnostics and degraded mode (clipboard fallback),
 *  5. handle multi-tab lifecycle (tab close, navigation, orphan cleanup).
 *
 * @module content/main
 */

import { createLogger } from "../shared/log.js";
import { DiagnosticsCollector, formatReport } from "../shared/diagnostics.js";
import {
  MessageType,
  createMessage,
  describeRuntimeError,
  isExtensionMessage,
  sanitisePrompt,
} from "../shared/messaging.js";
import { assistantCandidatesForHost, assistantSelectorsForHost, platformForHost } from "../shared/platforms.js";
import { ChatBridge } from "./bridge.js";
import { MoveWatcher } from "./observer.js";

const log = createLogger("content");

const STATUS = Object.freeze({
  READY: "ready",
  WAITING: "waiting-for-input",
  PROMPT_SENT: "prompt-sent",
  NO_INPUT: "input-missing",
  ERROR: "error",
  NO_MOVE: "no-move",
});

/**
 * @param {Record<string, unknown>} payload
 */
function notifyPanel(payload) {
  try {
    // The side panel may be closed; a rejected promise here is expected.
    chrome.runtime.sendMessage(createMessage(MessageType.CONTENT_STATUS, payload))?.catch?.(() => undefined);
  } catch (error) {
    log.debug("panel is not reachable", describeRuntimeError(error));
  }
}

/**
 * Boots the content script. Safe to call more than once.
 *
 * @returns {boolean} true when the script was started by this call.
 */
export function start() {
  if (globalThis.__AI_CHESS_COMPANION_STARTED__) {
    log.debug("already started");
    return false;
  }
  globalThis.__AI_CHESS_COMPANION_STARTED__ = true;

  const platform = platformForHost(window.location.hostname);
  const diagnostics = new DiagnosticsCollector({
    platform: platform?.id || "",
    url: window.location.href,
  });

  const bridge = new ChatBridge({ diagnostics, hostname: window.location.hostname });
  const watcher = new MoveWatcher({
    assistantSelectors: () => assistantSelectorsForHost(window.location.hostname),
    assistantCandidates: () => assistantCandidatesForHost(window.location.hostname),
    diagnostics,
    onMove: (event) => {
      if (event.noMove) {
        log.info("AI replied with no move (plan reply)", event.text?.slice(0, 200));
        notifyPanel({
          state: STATUS.NO_MOVE,
          text: event.text,
          platform: platform?.id || "",
          diagnostics: diagnostics.report,
        });
        try {
          chrome.runtime
            .sendMessage(
              createMessage(MessageType.CONTENT_STATUS, {
                state: STATUS.NO_MOVE,
                text: event.text,
                platform: platform?.id || "",
                diagnostics: diagnostics.report,
              }),
            )
            ?.catch?.(() => undefined);
        } catch (error) {
          log.warn("could not report no-move", describeRuntimeError(error));
        }
        return;
      }

      const { move, candidates } = event;
      log.info("AI replied with", move);
      notifyPanel({
        state: STATUS.READY,
        move,
        candidates,
        platform: platform?.id || "",
        diagnostics: diagnostics.report,
      });
      try {
        chrome.runtime
          .sendMessage(
            createMessage(MessageType.AI_MOVE, {
              move,
              candidates,
              platform: platform?.id || "",
              diagnostics: diagnostics.report,
            }),
          )
          ?.catch?.(() => undefined);
      } catch (error) {
        log.warn("could not report the AI move", describeRuntimeError(error));
      }
    },
  });

  // Handle page navigation / visibility
  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      diagnostics.setUrl(window.location.href);
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);

  const handleBeforeUnload = () => {
    watcher.stop();
  };
  window.addEventListener("beforeunload", handleBeforeUnload);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isExtensionMessage(message)) {
      return false;
    }

    if (message.type === MessageType.PING) {
      sendResponse({
        ok: true,
        platform: platform?.id || "",
        url: window.location.href,
        diagnostics: diagnostics.report,
      });
      return false;
    }

    if (message.type === "GET_DIAGNOSTICS") {
      sendResponse({ ok: true, report: diagnostics.report, formatted: formatReport(diagnostics.report) });
      return false;
    }

    if (message.type === "COPY_REPORT") {
      const formatted = formatReport(diagnostics.report);
      sendResponse({ ok: true, report: formatted });
      return false;
    }

    if (message.type !== MessageType.SEND_CHESS_PROMPT) {
      return false;
    }

    const prompt = sanitisePrompt(message.prompt);
    if (!prompt) {
      sendResponse({ ok: false, error: "The chess prompt is empty." });
      return false;
    }

    watcher.rememberPrompt(prompt);
    watcher.start();

    bridge
      .send(prompt)
      .then((result) => {
        if (result.ok) {
          log.info(`prompt submitted via ${result.method}`);
          notifyPanel({
            state: STATUS.PROMPT_SENT,
            method: result.method,
            platform: platform?.id || "",
            diagnostics: result.diagnostics || diagnostics.report,
          });
          sendResponse({ ok: true, method: result.method, diagnostics: result.diagnostics });
          return;
        }
        diagnostics.setError(result.error);
        notifyPanel({
          state: result.result,
          error: result.error,
          platform: platform?.id || "",
          diagnostics: result.diagnostics || diagnostics.report,
        });
        sendResponse({ ok: false, error: result.error, result: result.result, diagnostics: result.diagnostics });
      })
      .catch((error) => {
        log.error("sending the prompt failed", error);
        const detail = error?.message || "The chess prompt could not be sent.";
        diagnostics.setError(detail);
        notifyPanel({
          state: STATUS.ERROR,
          error: detail,
          platform: platform?.id || "",
          diagnostics: diagnostics.report,
        });
        sendResponse({ ok: false, error: detail, diagnostics: diagnostics.report });
      });

    return true;
  });

  notifyPanel({ state: STATUS.READY, platform: platform?.id || "", diagnostics: diagnostics.report });
  log.info(`ready on ${platform?.name || window.location.hostname} — diagnostics enabled`);

  // Expose diagnostics for manual debugging in console
  globalThis.__AI_CHESS_COMPANION_DIAGNOSTICS__ = diagnostics;

  return true;
}

export { STATUS };
