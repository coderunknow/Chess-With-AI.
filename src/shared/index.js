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
  BOARD_THEMES,
  DEFAULT_SETTINGS,
  DENSITIES,
  FONT_SCALES,
  LOCALES,
  MAX_RETRIES_LIMIT,
  PROMPT_STYLES,
  SETTINGS_KEY,
  THEMES,
  mergeSettings,
  normaliseSettings,
  resolveLocale,
  resolveTheme,
} from "./settings.js";
export { readValue, removeValue, writeValue } from "./storage.js";
export {
  GENERIC_INPUT_SELECTORS,
  GENERIC_SEND_SELECTORS,
  HOST_PATTERNS,
  PLATFORMS,
  SUPPORTED_HOSTS,
  assistantCandidatesForHost,
  assistantSelectorsForHost,
  inputCandidatesForHost,
  inputSelectorsForHost,
  isSupportedUrl,
  platformForHost,
  platformForUrl,
  sendCandidatesForHost,
  sendSelectorsForHost,
  transcriptCandidatesForHost,
  userCandidatesForHost,
  userSelectorsForHost,
} from "./platforms.js";
export { createEmptyReport, formatReport, DiagnosticsCollector } from "./diagnostics.js";
export { availableLocales, checkDictionaries, createTranslator, getDictionary } from "./i18n.js";
