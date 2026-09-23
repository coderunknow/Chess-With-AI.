/**
 * Content script entry point (ES module).
 *
 * Loaded by `index.js` through a dynamic `import()` because Manifest V3 does not
 * support `"type": "module"` for content scripts. Responsibilities:
 *
 *  1. answer `SEND_CHESS_PROMPT` messages from the side panel,
 *  2. watch the transcript for the AI's bracketed move and forward it,
 *  3. report its own state so the panel can explain what went wrong.
 *
 * @module content/main
 */

import { createLogger } from "../shared/log.js";
import {
  MessageType,
  createMessage,
  describeRuntimeError,
  isExtensionMessage,
  sanitisePrompt,
} from "../shared/messaging.js";
import { assistantSelectorsForHost, platformForHost } from "../shared/platforms.js";
import { ChatBridge } from "./bridge.js";
import { MoveWatcher } from "./observer.js";

const log = createLogger("content");

const STATUS = Object.freeze({
  READY: "ready",
  WAITING: "waiting-for-input",
  PROMPT_SENT: "prompt-sent",
  NO_INPUT: "input-missing",
  ERROR: "error",
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
  const bridge = new ChatBridge();
  const watcher = new MoveWatcher({
    assistantSelectors: () => assistantSelectorsForHost(window.location.hostname),
    onMove: ({ move, candidates }) => {
      log.info("AI replied with", move);
      notifyPanel({ state: STATUS.READY, move, candidates, platform: platform?.id || "" });
      try {
        chrome.runtime
          .sendMessage(createMessage(MessageType.AI_MOVE, { move, candidates, platform: platform?.id || "" }))
          ?.catch?.(() => undefined);
      } catch (error) {
        log.warn("could not report the AI move", describeRuntimeError(error));
      }
    },
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isExtensionMessage(message)) {
      return false;
    }

    if (message.type === MessageType.PING) {
      sendResponse({ ok: true, platform: platform?.id || "", url: window.location.href });
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
          sendResponse({ ok: true, method: result.method });
          return;
        }
        notifyPanel({ state: result.result, error: result.error, platform: platform?.id || "" });
        sendResponse({ ok: false, error: result.error });
      })
      .catch((error) => {
        log.error("sending the prompt failed", error);
        const detail = error?.message || "The chess prompt could not be sent.";
        notifyPanel({ state: STATUS.ERROR, error: detail, platform: platform?.id || "" });
        sendResponse({ ok: false, error: detail });
      });

    return true;
  });

  notifyPanel({ state: STATUS.READY, platform: platform?.id || "" });
  log.info(`ready on ${platform?.name || window.location.hostname}`);
  return true;
}

export { STATUS };
