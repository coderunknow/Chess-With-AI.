/**
 * Internationalisation — ESM dictionaries with interpolation and pluralisation.
 *
 * v0.2.0 ships `en` and `vi` locales. The module is pure (no DOM, no chrome.*)
 * so it can be tested in Node. The UI layer (`src/ui/i18n-view.js`) applies
 * translations to the DOM via `textContent`.
 *
 * Usage:
 *   import { createTranslator } from "../shared/i18n.js";
 *   const t = createTranslator('en');
 *   t('board.check', { color: 'White' })
 *
 * @module shared/i18n
 */

/** @type {Record<string, Record<string, string>>} */
const DICTIONARIES = {
  en: {
    // App
    "app.title": "AI Chess Companion",
    "app.eyebrow": "Chess against your AI",
    "app.loading": "Starting up…",

    // Board
    "board.label": "Chess board",
    "board.check": "{color} is in check",
    "board.checkmate": "Checkmate",
    "board.stalemate": "Stalemate",
    "board.empty": "empty",
    "board.selected": "selected",
    "board.legalMove": "legal move",

    // Status
    "status.yourMove": "Your move. Playing as {color}.",
    "status.yourMoveWhite": "Your move. Playing as White.",
    "status.yourMoveBlack": "Your move. Playing as Black.",
    "status.waitingAi": "Waiting for {platform} to answer…",
    "status.sending": "Sending your move to {platform}…",
    "status.noAi": "No AI chat detected. Open one of the supported AI chats to play.",
    "status.noAiAction": "Open an AI chat",
    "status.gameOver": "Game over",
    "status.newGame": "New game",
    "status.check": "You are in check — only legal escapes are shown.",
    "status.undo": "Took back {count} {count, plural, one {ply} other {plies}}.",
    "status.nothingToUndo": "There is nothing to undo yet.",
    "status.gameOverNew": "The game is over — start a new game to keep playing.",
    "status.aiTurn": "It is the AI's turn.",
    "status.aiBelongs": "That piece belongs to the AI.",
    "status.selectPiece": "Select one of your pieces first.",
    "status.noLegalMoves": "That piece has no legal moves.",
    "status.promotionCancelled": "Promotion cancelled.",
    "status.fenCopied": "FEN copied.",
    "status.pgnCopied": "PGN copied to the clipboard.",
    "status.copyFailed": "Copying failed — your browser blocked clipboard access.",
    "status.storageFull": "Storage is full — delete old games to free space.",
    "status.contentMissing": "Content script not found — reload the AI tab to connect.",
    "status.reloadTab": "Reload the tab",
    "status.copyPrompt": "Copy prompt",
    "status.promptCopied": "Prompt copied — paste it into the AI chat.",
    "status.askAi": "Ask the AI to move",
    "status.askAgain": "Ask again",
    "status.openAi": "Open an AI chat",
    "status.retrying": "Asking the AI again (attempt {attempt})…",
    "status.illegalAi": "The AI answered [{move}], which is not legal here. Ask again or adjust the position.",
    "status.couldNotReach": "Could not reach the AI tab: {detail}",
    "status.composerMissing": "Could not find the chat input box on this page.",
    "status.typeFailed": "Could not type the chess prompt into the chat input box.",
    "status.submitFailed": "Could not submit the prompt. Send it manually to continue.",

    // Controls
    "controls.undo": "Undo",
    "controls.newGame": "New game",
    "controls.flip": "Flip",
    "controls.askAi": "Ask the AI to move",
    "controls.copyPgn": "Copy PGN",
    "controls.openPgn": "PGN…",
    "controls.copyFen": "Copy FEN",
    "controls.settings": "Settings",

    // Moves
    "moves.title": "Moves",
    "moves.empty": "No moves yet. Play a white piece to start.",
    "moves.white": "white move",
    "moves.black": "black move",
    "moves.notPlayed": "not played",

    // Position
    "position.title": "Position",
    "position.fen": "Current FEN",

    // Connections
    "connections.title": "AI chat connections",
    "connections.hint":
      "Prompts are typed into the AI chat you already have open. Nothing leaves your browser otherwise.",
    "connections.openTab": "Open tab",

    // Promotion
    "promotion.title": "Promote the pawn",
    "promotion.queen": "Promote to queen",
    "promotion.rook": "Promote to rook",
    "promotion.bishop": "Promote to bishop",
    "promotion.knight": "Promote to knight",
    "promotion.cancel": "Cancel",

    // Settings
    "settings.title": "Settings",
    "settings.playAs": "Play as",
    "settings.playAsWhite": "White (moves first)",
    "settings.playAsBlack": "Black (the AI opens)",
    "settings.theme": "Theme",
    "settings.themeDark": "Dark",
    "settings.themeLight": "Light",
    "settings.themeSystem": "System",
    "settings.locale": "Language",
    "settings.localeEn": "English",
    "settings.localeVi": "Tiếng Việt",
    "settings.localeSystem": "System",
    "settings.boardTheme": "Board theme",
    "settings.boardClassic": "Classic",
    "settings.boardBlue": "Blue",
    "settings.boardGreen": "Green",
    "settings.boardHighContrast": "High contrast",
    "settings.fontScale": "Font scale",
    "settings.fontSmall": "Small",
    "settings.fontMedium": "Medium",
    "settings.fontLarge": "Large",
    "settings.density": "Density",
    "settings.densityComfortable": "Comfortable",
    "settings.densityCompact": "Compact",
    "settings.showCoordinates": "Show coordinates",
    "settings.showLegalTargets": "Highlight legal moves",
    "settings.highlightLastMove": "Highlight the last move",
    "settings.autoRetry": "Ask again when the AI answers an illegal move",
    "settings.persistGame": "Remember the game between sessions",
    "settings.soundEnabled": "Play sounds (move, capture, check)",
    "settings.clockEnabled": "Show clocks",
    "settings.animationsEnabled": "Animate moves",
    "settings.evalBarEnabled": "Show evaluation bar",
    "settings.hint": "Settings are stored locally. Nothing is uploaded.",
    "settings.done": "Done",
    "settings.reset": "Reset to defaults",

    // PGN
    "pgn.title": "Game PGN",
    "pgn.copy": "Copy",
    "pgn.load": "Load into board",
    "pgn.close": "Close",
    "pgn.placeholder": "Paste PGN here…",

    // Library
    "library.title": "Game library",
    "library.empty": "No saved games yet.",
    "library.new": "New game",
    "library.open": "Open",
    "library.rename": "Rename",
    "library.duplicate": "Duplicate",
    "library.delete": "Delete",
    "library.undoDelete": "Game deleted — Undo",
    "library.undo": "Undo",
    "library.search": "Search games",
    "library.import": "Import PGN",
    "library.export": "Export",
    "library.titleLabel": "Title",
    "library.date": "Date",
    "library.result": "Result",
    "library.moves": "{count} moves",

    // Analysis
    "analysis.title": "Analysis",
    "analysis.hint": "Local engine — heuristic evaluation, not perfect.",
    "analysis.bestMove": "Best move",
    "analysis.eval": "Evaluation",
    "analysis.hintButton": "Hint",
    "analysis.analyseGame": "Analyse game",
    "analysis.playVsEngine": "Play vs engine",
    "analysis.strength": "Strength",
    "analysis.accuracy": "Accuracy",
    "analysis.blunder": "Blunder",
    "analysis.mistake": "Mistake",
    "analysis.inaccuracy": "Inaccuracy",
    "analysis.good": "Good",
    "analysis.brilliant": "Brilliant",
    "analysis.heuristicNote": "This judgement is a heuristic estimate, not a perfect calculation.",
    "analysis.evaluating": "Evaluating…",
    "analysis.cancel": "Cancel",

    // Diagnostics
    "diagnostics.title": "Diagnostics",
    "diagnostics.platform": "Detected platform",
    "diagnostics.composer": "Composer",
    "diagnostics.sendButton": "Send button",
    "diagnostics.assistant": "Assistant messages",
    "diagnostics.timings": "Timings",
    "diagnostics.lastError": "Last error",
    "diagnostics.copyReport": "Copy report",
    "diagnostics.reportCopied": "Diagnostics copied.",
    "diagnostics.none": "None",
    "diagnostics.matched": "Matched: {selector}",
    "diagnostics.notFound": "Not found — using clipboard fallback",

    // Shortcuts
    "shortcuts.title": "Keyboard shortcuts",
    "shortcuts.newGame": "New game: N",
    "shortcuts.undo": "Undo: U",
    "shortcuts.flip": "Flip board: F",
    "shortcuts.copyPgn": "Copy PGN: C",
    "shortcuts.focusBoard": "Focus board: B",
    "shortcuts.hint": "Hint: H",
    "shortcuts.help": "Help: ?",
    "shortcuts.close": "Close: Escape",

    // Clock
    "clock.white": "White",
    "clock.black": "Black",

    // Generic
    "generic.ok": "OK",
    "generic.cancel": "Cancel",
    "generic.close": "Close",
    "generic.save": "Save",
    "generic.delete": "Delete",
    "generic.edit": "Edit",
    "generic.copy": "Copy",
    "generic.loading": "Loading…",
    "generic.error": "Error",
    "generic.success": "Success",
  },
  vi: {
    "app.title": "Trợ thủ Cờ vua AI",
    "app.eyebrow": "Chơi cờ với AI",
    "app.loading": "Đang khởi động…",

    "board.label": "Bàn cờ",
    "board.check": "{color} đang bị chiếu",
    "board.checkmate": "Chiếu hết",
    "board.stalemate": "Hòa cờ",
    "board.empty": "trống",
    "board.selected": "đã chọn",
    "board.legalMove": "nước đi hợp lệ",

    "status.yourMove": "Lượt của bạn. Bạn chơi {color}.",
    "status.yourMoveWhite": "Lượt của bạn. Bạn chơi Trắng.",
    "status.yourMoveBlack": "Lượt của bạn. Bạn chơi Đen.",
    "status.waitingAi": "Đang chờ {platform} trả lời…",
    "status.sending": "Đang gửi nước đi tới {platform}…",
    "status.noAi": "Không phát hiện tab AI. Mở một tab AI được hỗ trợ để chơi.",
    "status.noAiAction": "Mở tab AI",
    "status.gameOver": "Ván cờ kết thúc",
    "status.newGame": "Ván mới",
    "status.check": "Bạn đang bị chiếu — chỉ hiện nước đi hợp lệ để thoát.",
    "status.undo": "Đã lùi {count} {count, plural, one {nước} other {nước}}.",
    "status.nothingToUndo": "Chưa có gì để lùi.",
    "status.gameOverNew": "Ván cờ đã kết thúc — bắt đầu ván mới để tiếp tục.",
    "status.aiTurn": "Đến lượt AI.",
    "status.aiBelongs": "Quân đó của AI.",
    "status.selectPiece": "Hãy chọn một quân của bạn trước.",
    "status.noLegalMoves": "Quân đó không có nước đi hợp lệ.",
    "status.promotionCancelled": "Đã hủy phong cấp.",
    "status.fenCopied": "Đã sao chép FEN.",
    "status.pgnCopied": "Đã sao chép PGN vào clipboard.",
    "status.copyFailed": "Sao chép thất bại — trình duyệt chặn truy cập clipboard.",
    "status.storageFull": "Bộ nhớ đầy — xóa ván cũ để giải phóng.",
    "status.contentMissing": "Không tìm thấy content script — tải lại tab AI để kết nối.",
    "status.reloadTab": "Tải lại tab",
    "status.copyPrompt": "Sao chép prompt",
    "status.promptCopied": "Đã sao chép prompt — dán vào chat AI.",
    "status.askAi": "Yêu cầu AI đi",
    "status.askAgain": "Hỏi lại",
    "status.openAi": "Mở tab AI",
    "status.retrying": "Đang hỏi lại AI (lần {attempt})…",
    "status.illegalAi": "AI trả lời [{move}] không hợp lệ. Hãy hỏi lại.",
    "status.couldNotReach": "Không thể kết nối tới tab AI: {detail}",
    "status.composerMissing": "Không tìm thấy ô nhập chat trên trang này.",
    "status.typeFailed": "Không thể gõ prompt cờ vua vào ô nhập.",
    "status.submitFailed": "Không thể gửi prompt. Hãy gửi thủ công để tiếp tục.",

    "controls.undo": "Lùi",
    "controls.newGame": "Ván mới",
    "controls.flip": "Lật bàn",
    "controls.askAi": "Yêu cầu AI đi",
    "controls.copyPgn": "Sao chép PGN",
    "controls.openPgn": "PGN…",
    "controls.copyFen": "Sao chép FEN",
    "controls.settings": "Cài đặt",

    "moves.title": "Nước đi",
    "moves.empty": "Chưa có nước đi. Chơi một quân trắng để bắt đầu.",
    "moves.white": "nước trắng",
    "moves.black": "nước đen",
    "moves.notPlayed": "chưa chơi",

    "position.title": "Thế cờ",
    "position.fen": "FEN hiện tại",

    "connections.title": "Kết nối AI",
    "connections.hint": "Prompt được gõ vào tab AI bạn đã mở. Không có gì khác rời khỏi trình duyệt.",
    "connections.openTab": "Mở tab",

    "promotion.title": "Phong cấp tốt",
    "promotion.queen": "Phong thành hậu",
    "promotion.rook": "Phong thành xe",
    "promotion.bishop": "Phong thành tượng",
    "promotion.knight": "Phong thành mã",
    "promotion.cancel": "Hủy",

    "settings.title": "Cài đặt",
    "settings.playAs": "Chơi bên",
    "settings.playAsWhite": "Trắng (đi trước)",
    "settings.playAsBlack": "Đen (AI mở)",
    "settings.theme": "Giao diện",
    "settings.themeDark": "Tối",
    "settings.themeLight": "Sáng",
    "settings.themeSystem": "Theo hệ thống",
    "settings.locale": "Ngôn ngữ",
    "settings.localeEn": "Tiếng Anh",
    "settings.localeVi": "Tiếng Việt",
    "settings.localeSystem": "Theo hệ thống",
    "settings.boardTheme": "Theme bàn cờ",
    "settings.boardClassic": "Cổ điển",
    "settings.boardBlue": "Xanh dương",
    "settings.boardGreen": "Xanh lá",
    "settings.boardHighContrast": "Tương phản cao",
    "settings.fontScale": "Cỡ chữ",
    "settings.fontSmall": "Nhỏ",
    "settings.fontMedium": "Vừa",
    "settings.fontLarge": "Lớn",
    "settings.density": "Mật độ",
    "settings.densityComfortable": "Thoải mái",
    "settings.densityCompact": "Gọn",
    "settings.showCoordinates": "Hiện tọa độ",
    "settings.showLegalTargets": "Làm nổi bật nước đi hợp lệ",
    "settings.highlightLastMove": "Làm nổi bật nước đi trước",
    "settings.autoRetry": "Hỏi lại khi AI trả lời nước không hợp lệ",
    "settings.persistGame": "Nhớ ván cờ giữa các phiên",
    "settings.soundEnabled": "Phát âm thanh (đi, ăn, chiếu)",
    "settings.clockEnabled": "Hiện đồng hồ",
    "settings.animationsEnabled": "Hoạt ảnh nước đi",
    "settings.evalBarEnabled": "Hiện thanh đánh giá",
    "settings.hint": "Cài đặt được lưu cục bộ. Không tải lên đâu cả.",
    "settings.done": "Xong",
    "settings.reset": "Đặt lại mặc định",

    "pgn.title": "PGN ván cờ",
    "pgn.copy": "Sao chép",
    "pgn.load": "Nạp vào bàn",
    "pgn.close": "Đóng",
    "pgn.placeholder": "Dán PGN vào đây…",

    "library.title": "Thư viện ván cờ",
    "library.empty": "Chưa có ván nào được lưu.",
    "library.new": "Ván mới",
    "library.open": "Mở",
    "library.rename": "Đổi tên",
    "library.duplicate": "Nhân bản",
    "library.delete": "Xóa",
    "library.undoDelete": "Đã xóa ván — Hoàn tác",
    "library.undo": "Hoàn tác",
    "library.search": "Tìm ván",
    "library.import": "Nhập PGN",
    "library.export": "Xuất",
    "library.titleLabel": "Tiêu đề",
    "library.date": "Ngày",
    "library.result": "Kết quả",
    "library.moves": "{count} nước",

    "analysis.title": "Phân tích",
    "analysis.hint": "Engine cục bộ — đánh giá heuristic, không hoàn hảo.",
    "analysis.bestMove": "Nước tốt nhất",
    "analysis.eval": "Đánh giá",
    "analysis.hintButton": "Gợi ý",
    "analysis.analyseGame": "Phân tích ván",
    "analysis.playVsEngine": "Chơi với engine",
    "analysis.strength": "Độ mạnh",
    "analysis.accuracy": "Độ chính xác",
    "analysis.blunder": "Sai lầm nghiêm trọng",
    "analysis.mistake": "Sai lầm",
    "analysis.inaccuracy": "Thiếu chính xác",
    "analysis.good": "Tốt",
    "analysis.brilliant": "Xuất sắc",
    "analysis.heuristicNote": "Đánh giá này là heuristic, không phải tính toán hoàn hảo.",
    "analysis.evaluating": "Đang đánh giá…",
    "analysis.cancel": "Hủy",

    "diagnostics.title": "Chẩn đoán",
    "diagnostics.platform": "Nền tảng phát hiện",
    "diagnostics.composer": "Ô nhập",
    "diagnostics.sendButton": "Nút gửi",
    "diagnostics.assistant": "Tin nhắn AI",
    "diagnostics.timings": "Thời gian",
    "diagnostics.lastError": "Lỗi cuối",
    "diagnostics.copyReport": "Sao chép báo cáo",
    "diagnostics.reportCopied": "Đã sao chép chẩn đoán.",
    "diagnostics.none": "Không có",
    "diagnostics.matched": "Khớp: {selector}",
    "diagnostics.notFound": "Không tìm thấy — dùng clipboard fallback",

    "shortcuts.title": "Phím tắt",
    "shortcuts.newGame": "Ván mới: N",
    "shortcuts.undo": "Lùi: U",
    "shortcuts.flip": "Lật bàn: F",
    "shortcuts.copyPgn": "Sao chép PGN: C",
    "shortcuts.focusBoard": "Focus bàn: B",
    "shortcuts.hint": "Gợi ý: H",
    "shortcuts.help": "Trợ giúp: ?",
    "shortcuts.close": "Đóng: Escape",

    "clock.white": "Trắng",
    "clock.black": "Đen",

    "generic.ok": "OK",
    "generic.cancel": "Hủy",
    "generic.close": "Đóng",
    "generic.save": "Lưu",
    "generic.delete": "Xóa",
    "generic.edit": "Sửa",
    "generic.copy": "Sao chép",
    "generic.loading": "Đang tải…",
    "generic.error": "Lỗi",
    "generic.success": "Thành công",
  },
};

/**
 * Simple interpolation with plural support:
 *   "Hello {name}"
 *   "{count} {count, plural, one {move} other {moves}}"
 *
 * @param {string} template
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
function interpolate(template, params = {}) {
  let result = String(template);

  // Handle plural: {count, plural, one {X} other {Y}}
  result = result.replace(
    /\{(\w+),\s*plural,\s*one\s*\{([^}]+)\}\s*other\s*\{([^}]+)\}\}/g,
    (_match, key, one, other) => {
      const value = Number(params[key]);
      if (Number.isNaN(value)) {
        return other;
      }
      return value === 1 ? one : other;
    },
  );

  // Simple {key}
  result = result.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = params[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });

  return result;
}

/**
 * @param {'en'|'vi'} locale
 * @returns {Record<string, string>} dictionary
 */
export function getDictionary(locale) {
  return DICTIONARIES[locale] || DICTIONARIES.en;
}

/**
 * @returns {string[]} available locales
 */
export function availableLocales() {
  return Object.keys(DICTIONARIES);
}

/**
 * Creates a translator function.
 *
 * @param {'en'|'vi'} locale
 * @returns {(key: string, params?: Record<string, unknown>) => string}
 */
export function createTranslator(locale) {
  const dict = getDictionary(locale);
  const fallback = DICTIONARIES.en;

  /**
   * @param {string} key
   * @param {Record<string, unknown>} [params]
   * @returns {string}
   */
  function t(key, params = {}) {
    const template = dict[key] ?? fallback[key] ?? key;
    return interpolate(template, params);
  }

  t.locale = locale;
  t.dict = dict;
  return t;
}

/**
 * Checks whether all dictionaries have the same keys.
 *
 * @returns {{ok: boolean, missing: Record<string, string[]>, extra: Record<string, string[]>}}
 */
export function checkDictionaries() {
  const locales = availableLocales();
  const baseKeys = new Set(Object.keys(DICTIONARIES.en));
  const missing = {};
  const extra = {};

  for (const locale of locales) {
    if (locale === "en") continue;
    const keys = new Set(Object.keys(DICTIONARIES[locale]));
    const miss = [...baseKeys].filter((k) => !keys.has(k));
    const ext = [...keys].filter((k) => !baseKeys.has(k));
    if (miss.length > 0) missing[locale] = miss;
    if (ext.length > 0) extra[locale] = ext;
  }

  return { ok: Object.keys(missing).length === 0 && Object.keys(extra).length === 0, missing, extra };
}

/**
 * Lists all translation keys used in source files (for the test that fails when
 * a user-facing string bypasses t()).
 *
 * This is a helper for tests, not for runtime.
 *
 * @param {string} source JavaScript source
 * @returns {string[]} keys found via t("...") calls
 */
export function extractTranslationKeys(source) {
  const keys = [];
  const pattern = /\bt\s*\(\s*["']([^"']+)["']/g;
  let match = pattern.exec(source);
  while (match !== null) {
    keys.push(match[1]);
    match = pattern.exec(source);
  }
  return keys;
}

export { DICTIONARIES };
