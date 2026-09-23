/**
 * Cross-cutting, DOM-free helpers shared by the service worker, the content
 * script and the side panel.
 *
 * @module shared
 */

export { APP_ID, APP_NAME, APP_VERSION, REPOSITORY_URL } from "./meta.js";
export { LOG_LEVEL, createLogger, setLogLevel } from "./log.js";
export {
  MAX_PROMPT_LENGTH,
  MAX_SCANNED_TEXT_LENGTH,
  MessageType,
  createMessage,
  describeRuntimeError,
  isExtensionMessage,
  isRecord,
  normaliseResponse,
  sanitisePrompt,
} from "./messaging.js";
export {
  AI_MOVE_PATTERN,
  RETRY_INSTRUCTION,
  buildMovePrompt,
  buildOpeningPrompt,
  buildRetryPrompt,
  extractBracketedMoves,
  extractMoveCandidates,
  formatMoveList,
  isEchoOfPrompt,
  normaliseUci,
} from "./prompt.js";
export {
  DEFAULT_SETTINGS,
  MAX_RETRIES_LIMIT,
  PROMPT_STYLES,
  SETTINGS_KEY,
  THEMES,
  mergeSettings,
  normaliseSettings,
} from "./settings.js";
export { readValue, removeValue, writeValue } from "./storage.js";
export {
  GENERIC_INPUT_SELECTORS,
  GENERIC_SEND_SELECTORS,
  HOST_PATTERNS,
  PLATFORMS,
  SUPPORTED_HOSTS,
  assistantSelectorsForHost,
  inputSelectorsForHost,
  isSupportedUrl,
  platformForHost,
  platformForUrl,
  sendSelectorsForHost,
  userSelectorsForHost,
} from "./platforms.js";
