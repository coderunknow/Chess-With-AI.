(function initSidePanel() {
  "use strict";

  const FILES = "abcdefgh";
  const PIECE_GLYPHS = {
    K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
  };
  const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const AI_HOSTS = new Set([
    "gemini.google.com",
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "grok.com",
    "www.perplexity.ai",
    "copilot.microsoft.com"
  ]);

  const boardElement = document.getElementById("board");
  const statusElement = document.getElementById("status");
  const turnElement = document.getElementById("turn");
  const lastMoveElement = document.getElementById("last-move");
  const fenElement = document.getElementById("fen");
  const resetButton = document.getElementById("reset");

  let game = parseFen(INITIAL_FEN);
  let selectedSquare = "";
  let legalTargets = [];
  let activeTabId = null;

  function squareName(file, rank) {
    return `${FILES[file]}${rank}`;
  }

  function squareToCoords(square) {
    if (!/^[a-h][1-8]$/.test(square)) {
      return null;
    }
    return { file: FILES.indexOf(square[0]), rank: Number(square[1]) };
  }

  function coordsToSquare(file, rank) {
    return file >= 0 && file < 8 && rank >= 1 && rank <= 8 ? squareName(file, rank) : "";
  }

  function isWhitePiece(piece) {
    return Boolean(piece) && piece === piece.toUpperCase();
  }

  function pieceColor(piece) {
    return isWhitePiece(piece) ? "w" : "b";
  }

  function emptyBoard() {
    const board = {};
    for (let rank = 1; rank <= 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        board[squareName(file, rank)] = "";
      }
    }
    return board;
  }

  function parseFen(fen) {
    const fields = fen.split(/\s+/);
    const board = emptyBoard();
    const ranks = (fields[0] || "").split("/");
    for (let row = 0; row < 8; row += 1) {
      let file = 0;
      for (const symbol of ranks[row] || "") {
        if (/^[1-8]$/.test(symbol)) {
          file += Number(symbol);
        } else if (file < 8) {
          board[squareName(file, 8 - row)] = symbol;
          file += 1;
        }
      }
    }
    return {
      board,
      sideToMove: fields[1] === "b" ? "b" : "w",
      castling: fields[2] && fields[2] !== "-" ? fields[2] : "",
      enPassant: fields[3] && fields[3] !== "-" ? fields[3] : "",
      halfmove: Number.parseInt(fields[4], 10) || 0,
      fullmove: Number.parseInt(fields[5], 10) || 1,
      history: []
    };
  }

  function cloneGame(source) {
    return {
      board: { ...source.board },
      sideToMove: source.sideToMove,
      castling: source.castling,
      enPassant: source.enPassant,
      halfmove: source.halfmove,
      fullmove: source.fullmove,
      history: [...source.history]
    };
  }

  function pathIsClear(state, from, to) {
    const origin = squareToCoords(from);
    const destination = squareToCoords(to);
    if (!origin || !destination) {
      return false;
    }
    const fileStep = Math.sign(destination.file - origin.file);
    const rankStep = Math.sign(destination.rank - origin.rank);
    let file = origin.file + fileStep;
    let rank = origin.rank + rankStep;
    while (file !== destination.file || rank !== destination.rank) {
      if (state.board[coordsToSquare(file, rank)]) {
        return false;
      }
      file += fileStep;
      rank += rankStep;
    }
    return true;
  }

  function findKing(state, color) {
    const king = color === "w" ? "K" : "k";
    return Object.keys(state.board).find((square) => state.board[square] === king) || "";
  }

  function isSquareAttacked(state, targetSquare, attackerColor) {
    const target = squareToCoords(targetSquare);
    if (!target) {
      return false;
    }

    const pawn = attackerColor === "w" ? "P" : "p";
    const pawnDirection = attackerColor === "w" ? 1 : -1;
    for (const fileOffset of [-1, 1]) {
      const source = coordsToSquare(target.file - fileOffset, target.rank - pawnDirection);
      if (source && state.board[source] === pawn) {
        return true;
      }
    }

    const knight = attackerColor === "w" ? "N" : "n";
    for (const [fileOffset, rankOffset] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
      const source = coordsToSquare(target.file + fileOffset, target.rank + rankOffset);
      if (source && state.board[source] === knight) {
        return true;
      }
    }

    const king = attackerColor === "w" ? "K" : "k";
    for (let fileOffset = -1; fileOffset <= 1; fileOffset += 1) {
      for (let rankOffset = -1; rankOffset <= 1; rankOffset += 1) {
        if (!fileOffset && !rankOffset) {
          continue;
        }
        const source = coordsToSquare(target.file + fileOffset, target.rank + rankOffset);
        if (source && state.board[source] === king) {
          return true;
        }
      }
    }

    const diagonalPieces = attackerColor === "w" ? ["B", "Q"] : ["b", "q"];
    const straightPieces = attackerColor === "w" ? ["R", "Q"] : ["r", "q"];
    for (const [fileStep, rankStep, pieces] of [[1, 1, diagonalPieces], [1, -1, diagonalPieces], [-1, 1, diagonalPieces], [-1, -1, diagonalPieces], [1, 0, straightPieces], [-1, 0, straightPieces], [0, 1, straightPieces], [0, -1, straightPieces]]) {
      let file = target.file + fileStep;
      let rank = target.rank + rankStep;
      while (file >= 0 && file < 8 && rank >= 1 && rank <= 8) {
        const piece = state.board[coordsToSquare(file, rank)];
        if (piece) {
          if (pieces.includes(piece)) {
            return true;
          }
          break;
        }
        file += fileStep;
        rank += rankStep;
      }
    }
    return false;
  }

  function isInCheck(state, color) {
    const kingSquare = findKing(state, color);
    return Boolean(kingSquare) && isSquareAttacked(state, kingSquare, color === "w" ? "b" : "w");
  }

  function isCastlingMove(from, to, piece) {
    return (piece === "K" || piece === "k")
      && (from === "e1" || from === "e8")
      && ["g1", "c1", "g8", "c8"].includes(to);
  }

  function isPseudoLegalMove(state, from, to) {
    const origin = squareToCoords(from);
    const destination = squareToCoords(to);
    const piece = state.board[from];
    const targetPiece = state.board[to];
    if (!origin || !destination || !piece || from === to || (targetPiece && pieceColor(targetPiece) === pieceColor(piece))) {
      return false;
    }

    const color = pieceColor(piece);
    const fileDelta = destination.file - origin.file;
    const rankDelta = destination.rank - origin.rank;
    const absFile = Math.abs(fileDelta);
    const absRank = Math.abs(rankDelta);

    if (piece.toLowerCase() === "p") {
      const direction = color === "w" ? 1 : -1;
      const startRank = color === "w" ? 2 : 7;
      const diagonalCapture = absFile === 1 && rankDelta === direction && (Boolean(targetPiece) || state.enPassant === to);
      const oneStep = fileDelta === 0 && rankDelta === direction && !targetPiece;
      const twoStep = fileDelta === 0 && rankDelta === direction * 2 && origin.rank === startRank && !targetPiece && !state.board[coordsToSquare(origin.file, origin.rank + direction)];
      return diagonalCapture || oneStep || twoStep;
    }

    if (piece.toLowerCase() === "n") {
      return (absFile === 1 && absRank === 2) || (absFile === 2 && absRank === 1);
    }
    if (piece.toLowerCase() === "b") {
      return absFile === absRank && pathIsClear(state, from, to);
    }
    if (piece.toLowerCase() === "r") {
      return (fileDelta === 0 || rankDelta === 0) && pathIsClear(state, from, to);
    }
    if (piece.toLowerCase() === "q") {
      return (fileDelta === 0 || rankDelta === 0 || absFile === absRank) && pathIsClear(state, from, to);
    }
    if (piece.toLowerCase() === "k") {
      if (absFile <= 1 && absRank <= 1) {
        return true;
      }
      if (!isCastlingMove(from, to, piece)) {
        return false;
      }
      const rights = state.castling;
      const isWhite = color === "w";
      const kingSide = destination.file > origin.file;
      const hasRight = isWhite ? rights.includes(kingSide ? "K" : "Q") : rights.includes(kingSide ? "k" : "q");
      const emptySquares = kingSide
        ? [coordsToSquare(origin.file + 1, origin.rank), coordsToSquare(origin.file + 2, origin.rank)]
        : [coordsToSquare(origin.file - 1, origin.rank), coordsToSquare(origin.file - 2, origin.rank), coordsToSquare(origin.file - 3, origin.rank)];
      const rookSquare = coordsToSquare(kingSide ? 7 : 0, origin.rank);
      const rook = isWhite ? "R" : "r";
      return hasRight && state.board[rookSquare] === rook && emptySquares.every((square) => !state.board[square]);
    }
    return false;
  }

  function makeMoveUnchecked(state, move) {
    const { from, to, promotion } = move;
    const piece = state.board[from];
    const capturedPiece = state.board[to];
    const origin = squareToCoords(from);
    const destination = squareToCoords(to);
    const isPawn = piece.toLowerCase() === "p";
    const isCapture = Boolean(capturedPiece) || (isPawn && state.enPassant === to && origin.file !== destination.file);

    state.board[from] = "";
    if (isPawn && state.enPassant === to && origin.file !== destination.file && !capturedPiece) {
      const capturedPawnSquare = coordsToSquare(destination.file, destination.rank + (pieceColor(piece) === "w" ? -1 : 1));
      state.board[capturedPawnSquare] = "";
    }

    if (isCastlingMove(from, to, piece)) {
      const kingSide = destination.file > origin.file;
      const rookFrom = coordsToSquare(kingSide ? 7 : 0, origin.rank);
      const rookTo = coordsToSquare(kingSide ? 5 : 3, origin.rank);
      state.board[rookTo] = state.board[rookFrom];
      state.board[rookFrom] = "";
    }

    let placedPiece = piece;
    if (isPawn && (destination.rank === 1 || destination.rank === 8)) {
      const chosenPromotion = (promotion || "q").toLowerCase();
      placedPiece = pieceColor(piece) === "w" ? chosenPromotion.toUpperCase() : chosenPromotion;
    }
    state.board[to] = placedPiece;

    let castling = state.castling;
    if (piece === "K") castling = castling.replace(/[KQ]/g, "");
    if (piece === "k") castling = castling.replace(/[kq]/g, "");
    if (from === "a1" || to === "a1") castling = castling.replace("Q", "");
    if (from === "h1" || to === "h1") castling = castling.replace("K", "");
    if (from === "a8" || to === "a8") castling = castling.replace("q", "");
    if (from === "h8" || to === "h8") castling = castling.replace("k", "");
    state.castling = castling;

    state.enPassant = "";
    if (isPawn && Math.abs(destination.rank - origin.rank) === 2) {
      state.enPassant = coordsToSquare(origin.file, (origin.rank + destination.rank) / 2);
    }
    state.halfmove = isPawn || isCapture ? 0 : state.halfmove + 1;
    if (state.sideToMove === "b") state.fullmove += 1;
    state.sideToMove = state.sideToMove === "w" ? "b" : "w";
    return { capturedPiece, isCapture };
  }

  function isLegalMove(state, from, to, promotion = "q") {
    const piece = state.board[from];
    if (!piece || pieceColor(piece) !== state.sideToMove || !isPseudoLegalMove(state, from, to)) {
      return false;
    }

    if (isCastlingMove(from, to, piece)) {
      if (isInCheck(state, state.sideToMove)) {
        return false;
      }
      const origin = squareToCoords(from);
      const middle = coordsToSquare(origin.file + (squareToCoords(to).file > origin.file ? 1 : -1), origin.rank);
      if (isSquareAttacked(state, middle, state.sideToMove === "w" ? "b" : "w")) {
        return false;
      }
    }

    const testState = cloneGame(state);
    makeMoveUnchecked(testState, { from, to, promotion });
    return !isInCheck(testState, state.sideToMove);
  }

  function getLegalTargets(state, from) {
    const targets = [];
    for (let rank = 1; rank <= 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        const to = squareName(file, rank);
        if (isLegalMove(state, from, to)) {
          targets.push(to);
        }
      }
    }
    return targets;
  }

  function toFen(state) {
    const rows = [];
    for (let rank = 8; rank >= 1; rank -= 1) {
      let row = "";
      let empty = 0;
      for (let file = 0; file < 8; file += 1) {
        const piece = state.board[squareName(file, rank)];
        if (!piece) {
          empty += 1;
        } else {
          if (empty) row += empty;
          empty = 0;
          row += piece;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return `${rows.join("/")} ${state.sideToMove} ${state.castling || "-"} ${state.enPassant || "-"} ${state.halfmove} ${state.fullmove}`;
  }

  function normaliseUci(value) {
    const move = String(value || "").trim().toLowerCase();
    return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? move : "";
  }

  function parseUci(value) {
    const move = normaliseUci(value);
    return move ? { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || "q", uci: move } : null;
  }

  function setStatus(message, kind = "") {
    statusElement.textContent = message;
    statusElement.dataset.kind = kind;
  }

  function render() {
    boardElement.replaceChildren();
    for (let rank = 8; rank >= 1; rank -= 1) {
      for (let file = 0; file < 8; file += 1) {
        const square = squareName(file, rank);
        const piece = game.board[square];
        const button = document.createElement("button");
        button.type = "button";
        button.className = `square ${(file + rank) % 2 ? "dark" : "light"}`;
        button.dataset.square = square;
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", `${square}${piece ? ` ${isWhitePiece(piece) ? "white" : "black"} ${piece.toLowerCase()}` : " empty"}`);
        if (square === selectedSquare) button.classList.add("selected");
        if (legalTargets.includes(square)) button.classList.add(game.board[square] ? "capture-target" : "legal-target");
        if (game.history.length && [game.history.at(-1).from, game.history.at(-1).to].includes(square)) button.classList.add("last-move");

        if (piece) {
          const span = document.createElement("span");
          span.className = `piece ${isWhitePiece(piece) ? "white-piece" : "black-piece"}`;
          span.textContent = PIECE_GLYPHS[piece] || "";
          span.setAttribute("aria-hidden", "true");
          button.append(span);
        }
        boardElement.append(button);
      }
    }
    turnElement.textContent = game.sideToMove === "w" ? "White" : "Black (AI)";
    lastMoveElement.textContent = game.history.at(-1)?.uci || "—";
    fenElement.textContent = toFen(game);
  }

  async function getActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = tabs[0];
      if (tab && Number.isInteger(tab.id)) {
        activeTabId = tab.id;
        return tab;
      }
    } catch (error) {
      console.warn("Could not identify the active AI tab.", error);
    }
    return null;
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch {
      // The content script is normally present from the manifest. Injection can fail on browser-owned pages.
    }
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { ok: false, error: error.message } : (response || { ok: true }));
      });
    });
  }

  async function sendMoveToAi(uci) {
    const tab = await getActiveTab();
    if (!tab || !isSupportedAiUrl(tab.url)) {
      setStatus("Open Gemini, ChatGPT, Claude, Grok, or another supported AI chat tab first.", "error");
      return;
    }

    await ensureContentScript(tab.id);
    const prompt = [
      "You are the black side in a chess game.",
      `The human just played [${uci}].`,
      `Current position (FEN): ${toFen(game)}`,
      "Choose one legal move for Black from this exact position.",
      "Return the move in UCI coordinate notation inside square brackets, for example [g8f6].",
      "You may add a short explanation after the bracketed move."
    ].join("\n");
    const response = await sendTabMessage(tab.id, { type: "SEND_CHESS_PROMPT", prompt, uci, fen: toFen(game) });
    if (!response.ok) {
      setStatus(response.error || "The chess prompt could not be sent to the active AI tab.", "error");
      return;
    }
    setStatus("Waiting for the AI to reply with a bracketed UCI move…");
  }

  function applyMove(move, source) {
    if (!move || !isLegalMove(game, move.from, move.to, move.promotion)) {
      return false;
    }
    const movingPiece = game.board[move.from];
    makeMoveUnchecked(game, move);
    game.history.push({ uci: move.uci, from: move.from, to: move.to, source, piece: movingPiece });
    selectedSquare = "";
    legalTargets = [];
    render();
    return true;
  }

  async function handleUserMove(from, to) {
    const move = parseUci(`${from}${to}`);
    if (!move || !applyMove(move, "human")) {
      setStatus("That move is not legal in the current position.", "error");
      return;
    }
    setStatus(`Sent [${move.uci}] to the active AI tab.`, "success");
    await sendMoveToAi(move.uci);
  }

  function handleSquareClick(square) {
    const piece = game.board[square];
    if (game.sideToMove !== "w") {
      setStatus("Waiting for the AI to make its move.");
      return;
    }

    if (selectedSquare && legalTargets.includes(square)) {
      handleUserMove(selectedSquare, square);
      return;
    }

    if (selectedSquare === square) {
      selectedSquare = "";
      legalTargets = [];
      render();
      return;
    }

    if (piece && pieceColor(piece) === game.sideToMove) {
      selectedSquare = square;
      legalTargets = getLegalTargets(game, square);
      if (!legalTargets.length) {
        setStatus("That piece has no legal moves.", "error");
      }
      render();
      return;
    }

    selectedSquare = "";
    legalTargets = [];
    render();
  }

  function handleAiMove(value) {
    const move = parseUci(value);
    if (!move) {
      return;
    }
    if (game.sideToMove !== "b") {
      setStatus("Ignored a stale AI move because it is currently your turn.", "error");
      return;
    }
    if (!applyMove(move, "ai")) {
      setStatus(`The AI returned illegal move [${move.uci}] for this position.`, "error");
      return;
    }
    setStatus(`AI played [${move.uci}]. Your turn.`, "success");
  }

  boardElement.addEventListener("click", (event) => {
    const squareElement = event.target.closest("[data-square]");
    if (squareElement) {
      handleSquareClick(squareElement.dataset.square);
    }
  });

  resetButton.addEventListener("click", () => {
    game = parseFen(INITIAL_FEN);
    selectedSquare = "";
    legalTargets = [];
    render();
    setStatus("Game reset. Your turn. Select a white piece.", "success");
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "AI_MOVE") {
      handleAiMove(message.move);
    }
    if (message?.type === "ACTIVE_TAB_CHANGED" && Number.isInteger(message.tabId)) {
      activeTabId = message.tabId;
    }
  });

  chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" }).then((response) => {
    if (response?.ok && Number.isInteger(response.tabId)) {
      activeTabId = response.tabId;
    }
  }).catch(() => undefined);

  render();
})();
