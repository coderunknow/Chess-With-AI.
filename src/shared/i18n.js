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
    "connections.hint": "Prompts go only to the AI tab you pin. Nothing leaves your browser otherwise.",
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

    "badge.paused": "AI Chess Companion — paused",
    "badge.pin": "AI Chess Companion — pin an AI chat tab to play",
    "badge.pinned": "AI Chess Companion — pinned to {platform}",
    "badge.check": "AI Chess Companion — {color} is in check",
    "badge.white": "AI Chess Companion — White to move",
    "badge.black": "AI Chess Companion — Black to move",

    // v0.5 connection, retry, match and settings controls
    "connections.pinned": "Pinned: {platform} — {title}",
    "connections.choosePin": "Choose and pin one supported AI tab before sending a prompt.",
    "connections.noTabs": "No supported AI tabs open. Open one below, then refresh.",
    "connections.pinMarker": "PINNED",
    "connections.pinLost": "The pinned AI tab closed or left a supported host. Choose another tab; no prompt was sent.",
    "connections.pinFailed": "That tab could not be pinned. Open a supported AI chat and try again.",
    "connections.unpinned": "AI tab unpinned. Choose a tab before the next prompt.",
    "connections.refresh": "Refresh tabs",
    "connections.unpin": "Unpin",
    "connections.tabList": "Open AI chat tabs",
    "controls.playWhite": "Play White",
    "controls.playBlack": "Play Black",
    "controls.pause": "Pause",
    "controls.resume": "Resume",
    "controls.confirmSide": "Start a NEW game as the other side? The current game will end.",
    "controls.switchSideTitle": "Start a new game as the other side",
    "status.sideNewGame": "You now play {color}. A new game has started.",
    "status.paused": "Companion paused. No prompts or observers are active.",
    "status.resumed": "Companion resumed. Ask the AI again when a reply is expected.",
    "status.waitGeneration": "Waiting for {platform} to finish generating… Do not press Enter.",
    "status.manualSend": "Copy the prompt, paste and send it yourself in the pinned AI tab. The reply will be watched.",
    "status.manualCopied": "Prompt copied. Paste and send it yourself in the pinned AI tab; waiting for your message.",
    "status.timeoutCopied": "The AI is still generating. The prompt was copied; nothing was sent.",
    "status.generationTimeout": "The model is still generating. No prompt was sent; copy it to send later.",
    "status.verifyFailed": "The full prompt was not in the composer. Nothing was sent. Copy it instead.",
    "status.retryReason": "Asking again (attempt {attempt}) — {reason}",
    "status.illegalReason": "The AI answered [{move}]: {reason} Ask again to correct it.",
    "status.outOfTurn": "Ignored [{move}]: it is your turn.",
    "status.noMove": "no move",
    "status.repeatedMove": "repeated move",
    "status.aiResigned": "The AI resigned. Start a new game to play again.",
    "status.sendFailure": "Could not send the prompt: {detail} Copy it instead.",
    "settings.groupBoard": "Board",
    "settings.groupSound": "Sound",
    "settings.groupClock": "Clock",
    "settings.groupAi": "AI",
    "settings.groupEngine": "Engine",
    "settings.maxRetries": "Maximum retries",
    "settings.sendMode": "Send mode",
    "settings.sendAuto": "Auto — send one message",
    "settings.sendManual": "Manual — copy and paste",
    "settings.generationWait": "Wait for generation (seconds)",
    "settings.soundVolume": "Volume",
    "settings.clockDuration": "Minutes per side",
    "settings.localLevel": "Local strength (1–8, no Elo)",
    "match.title": "Stockfish Elo match",
    "match.scale": "Stockfish UCI_Elo scale, not FIDE",
    "match.stockfishNotice":
      "Strength-limited Stockfish is GPL-3, runs locally, no network. Stockfish UCI_Elo scale, not FIDE.",
    "match.loading": "Loading Stockfish…",
    "match.engineReady": "Stockfish ready. UCI_Elo range: {min}–{max}.",
    "match.engineError": "Stockfish unavailable: {detail} Matches are disabled.",
    "match.paused": "Stockfish stopped while paused. Resume to reload it.",
    "match.unavailable": "WASM has not started",
    "match.noGames": "No rated games yet. Complete a real game against the pinned chat AI.",
    "match.estimate":
      "{n} games · W–D–L {wins}–{draws}–{losses} · {rating} {boundary} · 95% interval [{low}, {high}] {provisional}",
    "match.provisional": "provisional",
    "match.boundary": "(bounded MLE)",
    "match.anchor": "Stockfish anchor UCI_Elo",
    "match.moveTime": "Move time (ms)",
    "match.start": "Start rated game",
    "match.stop": "Stop match",
    "match.export": "Export match PGNs",
    "match.exported": "Match PGNs copied and exported.",
    "match.requiresAuto": "Rated matches require Auto send mode. Change it in AI settings.",
    "match.requiresPin": "Rated matches require one live pinned AI chat tab.",
    "match.confirmReplace": "Start a rated Stockfish match? This starts a NEW game and replaces the current board.",
    "match.started": "Rated game started. Chat AI plays {color}; Stockfish anchor {anchor}.",
    "match.engineThinking": "Stockfish is choosing a move at UCI_Elo {anchor}…",
    "match.unratedProtocol": "Protocol failed: game unfinished / unrated. No engine move replaced the AI.",
    "match.unratedStopped": "Match stopped: game unfinished / unrated.",
    "match.pinLost": "Pinned tab lost: match unfinished / unrated. Pin another chat to play.",
    "match.storageError": "Could not store the rated game. No estimate was updated.",
    "match.finished": "Rated game finished: {result}. See the estimate in Analysis.",
    "match.saving": "Saving the finished rated game…",
    "match.running": "Stop the rated match before loading a different game.",
    "analysis.confirmEngine": "Start a NEW local game against the heuristic engine? This replaces the current board.",
    "analysis.engineMode": "Local engine game started (strength 1–8, no Elo).",
    "analysis.engineFailed": "The local engine could not make a move.",
    // Status, outcome and controls shared by the panel and browser locales
    "meta.turn": "Turn",
    "meta.opponent": "Opponent",
    "status.turn": "{color} to move",
    "status.awaitingUnpinned": "It is {color}’s turn, but no AI chat is pinned. Pin one supported tab to continue.",
    "status.newGameGoodLuck": "New game. Good luck!",
    "status.gameRestored": "Game restored.",
    "status.positionSet": "Position set from FEN.",
    "status.gameResetUndo": "Game reset — Undo",
    "outcome.checkmateWin": "Checkmate — you win as {color}! {result}",
    "outcome.checkmateLose": "Checkmate — the AI wins. {result}",
    "outcome.stalemate": "Draw by stalemate. {result}",
    "outcome.fiftyMove": "Draw by the fifty-move rule. {result}",
    "outcome.insufficientMaterial": "Draw — not enough material to mate. {result}",
    "outcome.threefold": "Draw by threefold repetition. {result}",
    "controls.pasteFen": "Paste FEN",
    "controls.copyPosition": "Copy position",
    "library.exportAll": "Export all",
    "library.renameGame": "Rename game",
    "analysis.stopEngine": "Stop",
    "analysis.evalHeuristic": "Eval: {score} (heuristic)",
    "analysis.moveAnnouncement": "{color} played {san}, {uci}",
    "diagnostics.showDetails": "Show details",
    "diagnostics.hideDetails": "Hide details",
    "fen.setup": "Set up position (FEN)",
    "fen.apply": "Apply",

    "illegal.malformed": "The coordinate move is malformed.",
    "illegal.repeated-move": "That move was already rejected in this position; choose a different legal move.",
    "illegal.empty-square": "The origin {from} is empty.",
    "illegal.opponent-piece": "The piece on {from} belongs to the other side.",
    "illegal.does-not-move-that-way": "That piece cannot move from {from} to {to}.",
    "illegal.blocked": "The path is blocked at {blocker}.",
    "illegal.leaves-king-in-check": "That move would leave the king in check.",
    "illegal.castle-rights": "Castling rights or the required rook are missing.",
    "illegal.castle-blocked": "Castling is blocked at {blocker}.",
    "illegal.castle-through-check": "The king cannot castle out of, through, or into check.",
    "illegal.en-passant-illegal": "There is no legal en passant capture on that square.",
    "illegal.promotion-required": "A pawn reaching the last rank needs a promotion suffix (q, r, b or n).",
    "illegal.promotion-illegal": "Promotion is only allowed on a pawn move to the last rank.",
    "illegal.not-in-legal-set": "That move is not in the legal set for this position.",

    // v0.6 delivery states, play view and interface settings
    "status.submitUnconfirmed":
      "One send attempt was made but could not be confirmed. Check the pinned chat before copying or sending anything.",
    "status.checkChat": "Check the chat",
    "status.stillWaiting": "Still waiting for {platform} to answer. The prompt stays sent — nothing is resent.",
    "status.loadCancelled": "Loading cancelled — the current game was kept.",
    "delivery.title": "What happened?",
    "delivery.neverAttempted": "The prompt was never sent — nothing was typed or clicked in the chat.",
    "delivery.attempted":
      "One send was attempted but could not be confirmed. Check the pinned chat first; only copy or send something if the message is missing there.",
    "delivery.confirmed": "The prompt was confirmed sent. Waiting for the chat to answer.",
    "delivery.answered": "The chat replied and its move was accepted on the board.",
    "delivery.stale": "An update from an older request arrived too late and was ignored.",
    "controls.confirmNewGame": "Start a NEW game? The current game will end.",
    "controls.confirmReplaceGame": "Replace the current game with this one?",
    "controls.more": "More",
    "connections.change": "Change",
    "chip.pinned": "{platform} — {title}",
    "chip.none": "No AI chat pinned",
    "play.youPlay": "You play {color}",
    "firstRun.text":
      "Pin one supported AI chat, pick a side, and make a move. The extension sends your position to that chat and plays its reply here. Settings holds everything else.",
    "firstRun.dismiss": "Got it",
    "help.title": "How playing works",
    "help.pinnedChat":
      "The pinned AI chat plays your opponent: each legal move is sent there once, and only its new reply moves a piece.",
    "help.localTools":
      "Hint and Analyse run a small local engine for suggestions only — they never play for the chat AI.",
    "help.rated":
      "A rated match is separate: local Stockfish (UCI_Elo scale, not FIDE) plays one side against the chat AI, with its own history.",
    "match.banner": "RATED · Chat AI plays {chatColor} · Stockfish plays {engineColor} (UCI_Elo {anchor})",
    "match.ratedSection": "Rated Stockfish match",
    "settings.groupInterface": "Interface",
    "settings.interfaceDetail": "Interface detail",
    "settings.interfaceSimple": "Simple (recommended)",
    "settings.interfaceAdvanced": "Advanced (technical details)",
    "settings.boardOrientation": "Board orientation",
    "settings.orientationFollow": "Follow the side you play",
    "settings.orientationWhite": "White at the bottom",
    "settings.orientationBlack": "Black at the bottom",
    "settings.moveListFormat": "Move list format",
    "settings.moveListSan": "SAN (e4, Nf3)",
    "settings.moveListUci": "UCI (e2e4, g1f3)",
    "settings.moveInteraction": "Move interaction",
    "settings.interactionTapDrag": "Tap and drag",
    "settings.interactionTap": "Tap only",
    "settings.interactionDrag": "Drag only",
    "settings.confirmDestructive": "Confirm before replacing a game or switching sides",
    "settings.confirmDestructiveHint": "Rated matches always ask for confirmation, even when this is off.",
    "settings.waitingReminder": "“Still waiting” reminder",
    "settings.waitingReminderOff": "Off",
    "settings.waitingReminder30s": "After 30 seconds",
    "settings.waitingReminder60s": "After 1 minute",
    "settings.waitingReminder2m": "After 2 minutes",
    "settings.reminderOff": "Off",
    "settings.reminderShort": "After 30 seconds",
    "settings.reminderMedium": "After 1 minute",
    "settings.reminderLong": "After 2 minutes",
    "settings.reminderHint":
      "Shows a quiet reminder while a reply is pending. It never resends the prompt or changes the result.",
    "more.title": "More",
    "tools.title": "Tools",
    "battle.title": "AI battle (unrated)",
    "battle.separation": "Battles are UNRATED. Rated match records are never touched by a battle.",
    "battle.opponentTab": "Opponent tab",
    "battle.opponentColor": "Opponent plays",
    "battle.playWhite": "White",
    "battle.playBlack": "Black",
    "battle.minutes": "Minutes per side",
    "battle.increment": "Increment (seconds)",
    "battle.start": "Start battle",
    "battle.pause": "Pause",
    "battle.resume": "Resume",
    "battle.askAgain": "Ask again",
    "battle.abort": "Abort battle",
    "battle.rematch": "Rematch",
    "battle.export": "Export battle PGN",
    "battle.exportAll": "Export all battles",
    "battle.empty": "No battles recorded yet.",
    "battle.wdl": "{white} vs {black}: {w}W-{d}D-{l}L",
    "battle.startCancelled": "Battle not started \u2014 the current game was kept.",
    "battle.manualMode": "Battles need Auto send mode. Switch to Auto to start one.",
    "battle.needsMainPin": "Pin an AI tab first, then start the battle.",
    "battle.pinFailed": "Could not pin the opponent tab for the battle.",
    "battle.pausedByUser": "Battle paused. The clock is stopped.",
    "battle.restored": "Battle restored (paused). Resume when you are ready — nothing was sent.",
    "battle.aborted": "Battle aborted — unfinished, no ledger entry.",
    "battle.finished": "Battle over: {result} ({reason}). Unrated.",
    "battle.deliveryContradicted":
      "the composer showed a different message (contradiction) — nothing is sent with certainty, fail-closed.",
    "battle.deliveryUnconfirmed": "the send was never confirmed — nothing else was sent.",
    "battle.deliveryUnreachable": "the tab could not be reached.",
    "battle.deliveryFailed": "the send failed.",
    "battle.noMove": "no move came back",
    "battle.illegal": "illegal move",
    "battle.pausedIllegal": "illegal or missing replies after {count} retries. Ask again, Abort, or Export.",

    "battle.history": "Battles history",
    "studio.title": "Prompt Studio",
    "studio.empty": "The preview is the exact prompt the send path would dispatch.",
    "studio.platform": "Platform: {label}",
    "studio.styleLabel": "Preview style",
    "studio.metrics": "{chars} characters \u00b7 {lines} lines",
    "studio.overBudget": "Over the 800-character budget \u2014 review before relying on it.",
    "studio.copy": "Copy prompt",
    "studio.copied": "Prompt copied.",
    "timeline.title": "Latency timeline",
    "timeline.privacy": "Stage timings only (ms deltas). Never message text, FENs or titles.",
    "timeline.copy": "Copy (redacted)",
    "timeline.copied": "Timeline copied (redacted).",
    "timeline.empty": "No completed moves yet.",
    "timeline.moveLabel": "Move {n}: total {total} ms",
    // v0.7 response styles and modes (enforced against _locales by the i18n suite)
    "settings.responseStyle": "Response style",
    "settings.styleStandard": "Standard",
    "settings.styleConcise": "Concise",
    "settings.styleEfficient": "Efficient — move only",
    "settings.styleFun": "Fun — with commentary",
    "settings.funSentences": "Fun commentary (sentences)",
    "settings.funSentencesHint":
      "Fun mode adds 1\u20132 short witty sentences after the move. The move is always parsed first.",
    "status.submitNotDispatched":
      "Nothing was submitted — the chat accepted no send action. Copy it and send it yourself.",

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
    "connections.hint": "Lời nhắc chỉ được gửi tới tab AI bạn ghim. Không có gì khác rời khỏi trình duyệt.",
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

    "badge.paused": "Trợ thủ Cờ vua AI — đã tạm dừng",
    "badge.pin": "Trợ thủ Cờ vua AI — ghim một tab AI để chơi",
    "badge.pinned": "Trợ thủ Cờ vua AI — đã ghim vào {platform}",
    "badge.check": "Trợ thủ Cờ vua AI — {color} đang bị chiếu",
    "badge.white": "Trợ thủ Cờ vua AI — đến lượt Trắng",
    "badge.black": "Trợ thủ Cờ vua AI — đến lượt Đen",

    // v0.5 connection, retry, match and settings controls
    "connections.pinned": "Đã ghim: {platform} — {title}",
    "connections.choosePin": "Chọn và ghim một tab AI được hỗ trợ trước khi gửi lời nhắc.",
    "connections.noTabs": "Chưa mở tab AI phù hợp. Mở tab bên dưới rồi làm mới.",
    "connections.pinMarker": "ĐÃ GHIM",
    "connections.pinLost": "Tab AI đã ghim bị đóng hoặc rời trang được hỗ trợ. Chọn tab khác; chưa gửi lời nhắc.",
    "connections.pinFailed": "Không thể ghim tab này. Hãy mở trang AI được hỗ trợ rồi thử lại.",
    "connections.unpinned": "Đã bỏ ghim tab AI. Hãy chọn tab trước lời nhắc tiếp theo.",
    "connections.refresh": "Làm mới tab",
    "connections.unpin": "Bỏ ghim",
    "connections.tabList": "Các tab AI đang mở",
    "controls.playWhite": "Chơi Trắng",
    "controls.playBlack": "Chơi Đen",
    "controls.pause": "Tạm dừng",
    "controls.resume": "Tiếp tục",
    "controls.confirmSide": "Bắt đầu ván MỚI với bên còn lại? Ván hiện tại sẽ kết thúc.",
    "controls.switchSideTitle": "Bắt đầu ván mới với bên còn lại",
    "status.sideNewGame": "Bạn chơi {color}. Đã bắt đầu ván mới.",
    "status.paused": "Đã tạm dừng. Không gửi lời nhắc hoặc theo dõi phản hồi.",
    "status.resumed": "Đã tiếp tục. Hãy yêu cầu AI khi cần phản hồi.",
    "status.waitGeneration": "Đang chờ {platform} trả lời xong… Đừng nhấn Enter.",
    "status.manualSend": "Sao chép lời nhắc, dán và tự gửi trong tab AI đã ghim. Phản hồi vẫn được theo dõi.",
    "status.manualCopied": "Đã sao chép lời nhắc. Hãy dán và tự gửi trong tab AI đã ghim; đang chờ tin nhắn.",
    "status.timeoutCopied": "AI vẫn đang trả lời. Đã sao chép lời nhắc; chưa gửi gì.",
    "status.generationTimeout": "AI vẫn đang trả lời. Chưa gửi lời nhắc; hãy sao chép để gửi sau.",
    "status.verifyFailed": "Ô nhập không chứa toàn bộ lời nhắc. Chưa gửi gì; hãy sao chép.",
    "status.retryReason": "Đang hỏi lại (lần {attempt}) — {reason}",
    "status.illegalReason": "AI trả lời [{move}]: {reason} Hỏi lại để sửa nước đi.",
    "status.outOfTurn": "Bỏ qua [{move}]: đến lượt của bạn.",
    "status.noMove": "không có nước đi",
    "status.repeatedMove": "nước đi lặp lại",
    "status.aiResigned": "AI đã xin thua. Hãy bắt đầu ván mới.",
    "status.sendFailure": "Không gửi được lời nhắc: {detail} Hãy sao chép.",
    "settings.groupBoard": "Bàn cờ",
    "settings.groupSound": "Âm thanh",
    "settings.groupClock": "Đồng hồ",
    "settings.groupAi": "AI",
    "settings.groupEngine": "Engine",
    "settings.maxRetries": "Số lần hỏi lại tối đa",
    "settings.sendMode": "Chế độ gửi",
    "settings.sendAuto": "Tự động — gửi một tin nhắn",
    "settings.sendManual": "Thủ công — sao chép và dán",
    "settings.generationWait": "Chờ AI trả lời xong (giây)",
    "settings.soundVolume": "Âm lượng",
    "settings.clockDuration": "Phút mỗi bên",
    "settings.localLevel": "Độ mạnh cục bộ (1–8, không phải Elo)",
    "match.title": "Trận đo Elo với Stockfish",
    "match.scale": "Stockfish UCI_Elo scale, not FIDE — thang UCI_Elo của Stockfish, không phải FIDE",
    "match.stockfishNotice":
      "Stockfish giới hạn sức mạnh theo GPL-3, chạy cục bộ, không kết nối mạng. Stockfish UCI_Elo scale, not FIDE.",
    "match.loading": "Đang tải Stockfish…",
    "match.engineReady": "Stockfish sẵn sàng. Khoảng UCI_Elo: {min}–{max}.",
    "match.engineError": "Không dùng được Stockfish: {detail} Trận đo sức mạnh bị tắt.",
    "match.paused": "Stockfish đã dừng khi tạm nghỉ. Tiếp tục để tải lại.",
    "match.unavailable": "WASM chưa khởi động",
    "match.noGames": "Chưa có ván xếp hạng. Hãy hoàn tất một ván thật với AI trong tab đã ghim.",
    "match.estimate":
      "{n} ván · Thắng–Hòa–Thua {wins}–{draws}–{losses} · {rating} {boundary} · khoảng 95% [{low}, {high}] {provisional}",
    "match.provisional": "tạm tính",
    "match.boundary": "(MLE ở biên)",
    "match.anchor": "Mốc Stockfish UCI_Elo",
    "match.moveTime": "Thời gian mỗi nước (ms)",
    "match.start": "Bắt đầu ván xếp hạng",
    "match.stop": "Dừng trận",
    "match.export": "Xuất PGN trận đấu",
    "match.exported": "Đã sao chép và xuất PGN trận đấu.",
    "match.requiresAuto": "Trận xếp hạng cần chế độ Gửi tự động. Đổi trong cài đặt AI.",
    "match.requiresPin": "Trận xếp hạng cần một tab AI đang mở và đã ghim.",
    "match.confirmReplace": "Bắt đầu trận Stockfish xếp hạng? Ván MỚI sẽ thay thế bàn cờ hiện tại.",
    "match.started": "Đã bắt đầu ván xếp hạng. AI chơi {color}; mốc Stockfish {anchor}.",
    "match.engineThinking": "Stockfish đang chọn nước ở UCI_Elo {anchor}…",
    "match.unratedProtocol": "Lỗi giao thức: ván chưa xong / không tính điểm. Engine không đi thay AI.",
    "match.unratedStopped": "Đã dừng trận: ván chưa xong / không tính điểm.",
    "match.pinLost": "Mất tab đã ghim: ván chưa xong / không tính điểm. Hãy ghim tab khác.",
    "match.storageError": "Không lưu được ván xếp hạng. Không cập nhật ước lượng.",
    "match.finished": "Ván xếp hạng kết thúc: {result}. Xem ước lượng trong Phân tích.",
    "match.saving": "Đang lưu ván xếp hạng đã kết thúc…",
    "match.running": "Hãy dừng trận xếp hạng trước khi nạp ván khác.",
    "analysis.confirmEngine": "Bắt đầu ván MỚI với engine heuristic cục bộ? Bàn cờ hiện tại sẽ bị thay thế.",
    "analysis.engineMode": "Đã bắt đầu ván với engine cục bộ (độ mạnh 1–8, không phải Elo).",
    "analysis.engineFailed": "Engine cục bộ không thể đi.",
    // Status, outcome and controls shared by the panel and browser locales
    "meta.turn": "Lượt",
    "meta.opponent": "Đối thủ",
    "status.turn": "Lượt {color}",
    "status.awaitingUnpinned": "Đến lượt {color}, nhưng chưa ghim tab AI. Hãy ghim một tab được hỗ trợ để tiếp tục.",
    "status.newGameGoodLuck": "Ván mới. Chúc bạn may mắn!",
    "status.gameRestored": "Đã khôi phục ván cờ.",
    "status.positionSet": "Đã đặt thế cờ từ FEN.",
    "status.gameResetUndo": "Đã đặt lại ván — Hoàn tác",
    "outcome.checkmateWin": "Chiếu hết — bạn thắng khi chơi {color}! {result}",
    "outcome.checkmateLose": "Chiếu hết — AI thắng. {result}",
    "outcome.stalemate": "Hòa do hết nước đi hợp lệ. {result}",
    "outcome.fiftyMove": "Hòa theo luật 50 nước. {result}",
    "outcome.insufficientMaterial": "Hòa — không đủ quân để chiếu hết. {result}",
    "outcome.threefold": "Hòa do lặp lại thế cờ ba lần. {result}",
    "controls.pasteFen": "Dán FEN",
    "controls.copyPosition": "Sao chép thế cờ",
    "library.exportAll": "Xuất tất cả",
    "library.renameGame": "Đổi tên ván cờ",
    "analysis.stopEngine": "Dừng",
    "analysis.evalHeuristic": "Đánh giá: {score} (heuristic)",
    "analysis.moveAnnouncement": "{color} đi {san}, {uci}",
    "diagnostics.showDetails": "Hiện chi tiết",
    "diagnostics.hideDetails": "Ẩn chi tiết",
    "fen.setup": "Thiết lập thế cờ (FEN)",
    "fen.apply": "Áp dụng",

    "illegal.malformed": "Nước đi tọa độ sai định dạng.",
    "illegal.repeated-move": "Nước này đã bị từ chối ở thế cờ hiện tại; hãy chọn nước hợp lệ khác.",
    "illegal.empty-square": "Ô xuất phát {from} trống.",
    "illegal.opponent-piece": "Quân ở {from} thuộc về bên kia.",
    "illegal.does-not-move-that-way": "Quân đó không thể đi từ {from} đến {to}.",
    "illegal.blocked": "Đường đi bị chặn ở {blocker}.",
    "illegal.leaves-king-in-check": "Nước đó khiến vua vẫn bị chiếu.",
    "illegal.castle-rights": "Không còn quyền nhập thành hoặc thiếu xe cần thiết.",
    "illegal.castle-blocked": "Đường nhập thành bị chặn ở {blocker}.",
    "illegal.castle-through-check":
      "Vua không thể nhập thành khi đang bị chiếu, đi qua ô bị chiếu hoặc vào ô bị chiếu.",
    "illegal.en-passant-illegal": "Không thể bắt tốt qua đường ở ô này.",
    "illegal.promotion-required": "Tốt đến hàng cuối cần thêm ký hiệu phong cấp (q, r, b hoặc n).",
    "illegal.promotion-illegal": "Chỉ được phong cấp khi tốt đến hàng cuối.",
    "illegal.not-in-legal-set": "Nước này không nằm trong các nước hợp lệ của thế cờ.",

    // v0.6 delivery states, play view and interface settings
    "status.submitUnconfirmed":
      "Đã thử gửi một lần nhưng không xác nhận được. Hãy kiểm tra tab chat đã ghim trước khi sao chép hay gửi bất cứ thứ gì.",
    "status.checkChat": "Kiểm tra tab chat",
    "status.stillWaiting": "Vẫn đang chờ {platform} trả lời. Lời nhắc đã gửi — không gửi lại.",
    "status.loadCancelled": "Đã hủy nạp — ván hiện tại được giữ nguyên.",
    "delivery.title": "Đã xảy ra gì?",
    "delivery.neverAttempted": "Lời nhắc chưa được gửi — chưa gõ hay bấm gì trong tab chat.",
    "delivery.attempted":
      "Đã thử gửi một lần nhưng không xác nhận được. Hãy kiểm tra tab chat trước; chỉ sao chép hoặc gửi nếu tin nhắn chưa có ở đó.",
    "delivery.confirmed": "Đã xác nhận lời nhắc được gửi. Đang chờ tab chat trả lời.",
    "delivery.answered": "Tab chat đã trả lời và nước đi được áp lên bàn cờ.",
    "delivery.stale": "Một cập nhật từ yêu cầu cũ đến trễ và đã bị bỏ qua.",
    "controls.confirmNewGame": "Bắt đầu ván MỚI? Ván hiện tại sẽ kết thúc.",
    "controls.confirmReplaceGame": "Thay ván hiện tại bằng ván này?",
    "controls.more": "Thêm",
    "connections.change": "Đổi",
    "chip.pinned": "{platform} — {title}",
    "chip.none": "Chưa ghim tab AI",
    "play.youPlay": "Bạn chơi {color}",
    "firstRun.text":
      "Hãy ghim một tab AI được hỗ trợ, chọn bên và đi một nước. Tiện ích gửi thế cờ tới tab đó và phát nước trả lời tại đây. Mọi thứ khác nằm trong Cài đặt.",
    "firstRun.dismiss": "Đã hiểu",
    "help.title": "Cách chơi",
    "help.pinnedChat":
      "Tab AI đã ghim đóng vai đối thủ: mỗi nước hợp lệ được gửi tới đó một lần, và chỉ câu trả lời mới di chuyển quân.",
    "help.localTools":
      "Gợi ý và Phân tích dùng engine cục bộ để đề xuất — chúng không bao giờ đi thay AI trong tab chat.",
    "help.rated":
      "Ván xếp hạng tách riêng: Stockfish cục bộ (thang UCI_Elo, không phải FIDE) chơi một bên với AI tab chat, có lịch sử riêng.",
    "match.banner": "XẾP HẠNG · AI tab chơi {chatColor} · Stockfish chơi {engineColor} (UCI_Elo {anchor})",
    "match.ratedSection": "Trận Stockfish xếp hạng",
    "settings.groupInterface": "Giao diện",
    "settings.interfaceDetail": "Chi tiết giao diện",
    "settings.interfaceSimple": "Đơn giản (khuyên dùng)",
    "settings.interfaceAdvanced": "Nâng cao (chi tiết kỹ thuật)",
    "settings.boardOrientation": "Hướng bàn cờ",
    "settings.orientationFollow": "Theo bên bạn chơi",
    "settings.orientationWhite": "Trắng ở dưới",
    "settings.orientationBlack": "Đen ở dưới",
    "settings.moveListFormat": "Định dạng danh sách nước",
    "settings.moveListSan": "SAN (e4, Nf3)",
    "settings.moveListUci": "UCI (e2e4, g1f3)",
    "settings.moveInteraction": "Cách đi nước",
    "settings.interactionTapDrag": "Chạm và kéo",
    "settings.interactionTap": "Chỉ chạm",
    "settings.interactionDrag": "Chỉ kéo",
    "settings.confirmDestructive": "Xác nhận trước khi thay ván hoặc đổi bên",
    "settings.confirmDestructiveHint": "Ván xếp hạng luôn hỏi xác nhận, kể cả khi tắt tùy chọn này.",
    "settings.waitingReminder": "Nhắc “vẫn đang chờ”",
    "settings.waitingReminderOff": "Tắt",
    "settings.waitingReminder30s": "Sau 30 giây",
    "settings.waitingReminder60s": "Sau 1 phút",
    "settings.waitingReminder2m": "Sau 2 phút",
    "settings.reminderOff": "Tắt",
    "settings.reminderShort": "Sau 30 giây",
    "settings.reminderMedium": "Sau 1 phút",
    "settings.reminderLong": "Sau 2 phút",
    "settings.reminderHint": "Hiện nhắc nhẹ khi đang chờ phản hồi. Không bao giờ gửi lại lời nhắc hay đổi kết quả.",
    "more.title": "Thêm",
    "tools.title": "Công cụ",
    "battle.title": "Đấu AI (không xếp hạng)",
    "battle.separation": "Ván đấu KHÔNG xếp hạng. Hồ sơ xếp hạng không bao giờ bị ván đấu chạm vào.",
    "battle.opponentTab": "Tab đối thủ",
    "battle.opponentColor": "Đối thủ cầm",
    "battle.playWhite": "Trắng",
    "battle.playBlack": "Đen",
    "battle.minutes": "Phút mỗi bên",
    "battle.increment": "Phụ cấp (giây)",
    "battle.start": "Bắt đầu ván đấu",
    "battle.pause": "Tạm dừng",
    "battle.resume": "Tiếp tục",
    "battle.askAgain": "Hỏi lại",
    "battle.abort": "Hủy ván đấu",
    "battle.rematch": "Đấu lại",
    "battle.export": "Xuất PGN ván đấu",
    "battle.exportAll": "Xuất tất cả ván đấu",
    "battle.empty": "Chưa có ván đấu nào được ghi.",
    "battle.wdl": "{white} gặp {black}: {w}T-{d}H-{l}B",
    "battle.startCancelled": "Chưa bắt đầu ván đấu \u2014 ván hiện tại được giữ nguyên.",
    "battle.manualMode": "Ván đấu cần chế độ Gửi tự động. Hãy chuyển sang Tự động để bắt đầu.",
    "battle.needsMainPin": "Hãy ghim một tab AI trước, rồi bắt đầu ván đấu.",
    "battle.pinFailed": "Không ghim được tab đối thủ cho ván đấu.",
    "battle.pausedByUser": "Ván đấu đã tạm dừng. Đồng hồ đã dừng.",
    "battle.restored": "Đã khôi phục ván đấu (tạm dừng). Tiếp tục khi bạn sẵn sàng — chưa gửi gì cả.",
    "battle.aborted": "Đã hủy ván đấu — chưa xong, không ghi sổ cái.",
    "battle.finished": "Ván đấu kết thúc: {result} ({reason}). Không xếp hạng.",
    "battle.deliveryContradicted":
      "ô nhập hiển thị nội dung khác (mâu thuẫn) — không gửi gì khi chưa chắc chắn, chặn an toàn.",
    "battle.deliveryUnconfirmed": "lần gửi không được xác nhận — không gửi thêm gì.",
    "battle.deliveryUnreachable": "không liên lạc được tab.",
    "battle.deliveryFailed": "lần gửi thất bại.",
    "battle.noMove": "không có nước đi nào quay lại",
    "battle.illegal": "nước đi không hợp lệ",
    "battle.pausedIllegal": "phản hồi sai hoặc thiếu sau {count} lần thử. Hãy Hỏi lại, Hủy, hoặc Xuất.",

    "battle.history": "Lịch sử ván đấu",
    "studio.title": "Studio lời nhắc",
    "studio.empty": "Phần xem trước là chính xác lời nhắc mà đường gửi sẽ phát đi.",
    "studio.platform": "Nền tảng: {label}",
    "studio.styleLabel": "Kiểu xem trước",
    "studio.metrics": "{chars} ký tự · {lines} dòng",
    "studio.overBudget": "Vượt ngân sách 800 ký tự — xem lại trước khi dùng.",
    "studio.copy": "Sao chép lời nhắc",
    "studio.copied": "Đã sao chép lời nhắc.",
    "timeline.title": "Dòng thời gian độ trễ",
    "timeline.privacy": "Chỉ mốc thời gian từng bước (ms). Không bao giờ nội dung tin nhắn, FEN hay tiêu đề.",
    "timeline.copy": "Sao chép (đã che)",
    "timeline.copied": "Đã sao chép dòng thời gian (đã che).",
    "timeline.empty": "Chưa có nước đi hoàn tất.",
    "timeline.moveLabel": "Nước {n}: tổng {total} ms",
    "settings.responseStyle": "Kiểu trả lời",
    "settings.styleStandard": "Tiêu chuẩn",
    "settings.styleConcise": "Súc tích",
    "settings.styleEfficient": "Hiệu quả — chỉ nước đi",
    "settings.styleFun": "Vui — kèm bình luận",
    "settings.funSentences": "Bình luận vui (số câu)",
    "settings.funSentencesHint":
      "Chế độ Vui thêm 1\u20132 câu bình luận dí dỏm sau nước đi. Nước đi luôn được đọc trước.",
    "status.submitNotDispatched": "Chưa gửi được gì — trang chat không chấp nhận thao tác gửi. Hãy sao chép và tự gửi.",

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
