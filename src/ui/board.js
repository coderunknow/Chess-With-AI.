/**
 * Board rendering.
 *
 * The visual model is produced by the pure {@link describeBoard} function, which
 * is unit-tested without a browser; {@link BoardView} only maps that model onto
 * DOM nodes. Cells are created once and updated in place, so re-rendering keeps
 * keyboard focus, hover state and CSS transitions intact.
 *
 * @module ui/board
 */

import { PIECE_GLYPHS, PIECE_NAMES, colorOf, isWhitePiece } from "../core/pieces.js";
import { FILES, RANKS, fileOf, isLightSquare, rankOf, toIndex, toName } from "../core/squares.js";
import { parseUci } from "../core/move.js";

/**
 * @typedef {object} BoardCell
 * @property {number} square square index.
 * @property {string} name algebraic name, e.g. `e4`.
 * @property {string} piece FEN character or `''`.
 * @property {string} glyph unicode piece or `''`.
 * @property {boolean} isLight square colour.
 * @property {boolean} isSelected
 * @property {boolean} isTarget legal destination marker.
 * @property {boolean} isCapture target holds an enemy piece.
 * @property {boolean} isLastMove
 * @property {boolean} isCheck the king on this square is in check.
 * @property {string} fileLabel coordinate label, `''` when disabled.
 * @property {string} rankLabel coordinate label, `''` when disabled.
 * @property {string} label accessible description.
 */

/**
 * @typedef {object} BoardDescription
 * @property {BoardCell[][]} rows rows in display order (top row first).
 * @property {BoardCell[]} cells all 64 cells in display order.
 * @property {boolean} flipped
 */

/**
 * Builds the description of every board cell.
 *
 * @param {object} input
 * @param {import('../core/position.js').Position} input.position
 * @param {number} [input.selected] selected square index, -1 for none.
 * @param {ReadonlyArray<string>} [input.targets] legal destination names.
 * @param {{from: number, to: number}|null} [input.lastMove] previous move squares.
 * @param {boolean} [input.flipped] true when Black is at the bottom.
 * @param {boolean} [input.showCoordinates]
 * @param {boolean} [input.showLegalTargets]
 * @returns {BoardDescription}
 */
export function describeBoard({
  position,
  selected = -1,
  targets = [],
  lastMove = null,
  flipped = false,
  showCoordinates = true,
  showLegalTargets = true,
}) {
  const targetSet = new Set(targets);
  const checkSquare = position.isCheck() ? position.kingSquare(position.turn) : -1;
  const rows = [];

  for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
    const rank = flipped ? rowIndex : 7 - rowIndex;
    const row = [];
    for (let columnIndex = 0; columnIndex < 8; columnIndex += 1) {
      const file = flipped ? 7 - columnIndex : columnIndex;
      const square = toIndex(file, rank);
      const piece = position.pieceAt(square);
      const name = toName(square);
      const isTarget = targetSet.has(name);
      const isLastMoveSquare = lastMove !== null && (square === lastMove.from || square === lastMove.to);

      /** @type {BoardCell} */
      const cell = {
        square,
        name,
        piece,
        glyph: piece ? PIECE_GLYPHS[piece] || "" : "",
        isLight: isLightSquare(square),
        isSelected: square === selected,
        isTarget,
        isCapture: isTarget && Boolean(piece),
        isLastMove: isLastMoveSquare,
        isCheck: square === checkSquare,
        fileLabel: showCoordinates && rank === (flipped ? 7 : 0) ? FILES[file] : "",
        rankLabel: showCoordinates && file === (flipped ? 7 : 0) ? RANKS[rank] : "",
        label: describeCell({ name, piece, isTarget, isSelected: square === selected, showLegalTargets }),
      };
      row.push(cell);
    }
    rows.push(row);
  }

  return { rows, cells: rows.flat(), flipped };
}

/**
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.piece
 * @param {boolean} input.isTarget
 * @param {boolean} input.isSelected
 * @param {boolean} input.showLegalTargets
 * @returns {string} accessible description of a square.
 */
function describeCell({ name, piece, isTarget, isSelected, showLegalTargets }) {
  const parts = [name];
  if (piece) {
    parts.push(`${isWhitePiece(piece) ? "white" : "black"} ${PIECE_NAMES[piece.toLowerCase()] || "piece"}`);
  } else {
    parts.push("empty");
  }
  if (isSelected) {
    parts.push("selected");
  }
  if (isTarget && showLegalTargets) {
    parts.push("legal move");
  }
  return parts.join(", ");
}

export class BoardView {
  /** @type {HTMLElement} */
  #root;
  /** @type {Map<number, HTMLButtonElement>} */
  #cells = new Map();
  /** @type {(square: number) => void} */
  #onSelect;
  #built = false;
  #focusedSquare = -1;

  /**
   * @param {HTMLElement} root container that receives the 8x8 grid.
   * @param {object} options
   * @param {(square: number) => void} options.onSelect called when a square is activated.
   */
  constructor(root, { onSelect }) {
    this.#root = root;
    this.#onSelect = onSelect;

    this.#root.addEventListener("click", (event) => {
      if (this.isStatic()) {
        return;
      }
      const square = this.#squareFromEvent(event);
      if (square !== null) {
        this.#onSelect(square);
      }
    });

    this.#root.addEventListener("keydown", (event) => this.#onKeyDown(event));
    this.#root.addEventListener("focusin", (event) => {
      const square = this.#squareFromEvent(event);
      if (square !== null) {
        this.#focusedSquare = square;
      }
    });
  }

  /**
   * Renders a board description, creating the grid on first use.
   *
   * @param {BoardDescription} description
   * @param {object} [options]
   * @param {number} [options.selected]
   * @param {boolean} [options.interactive] whether cells accept input.
   */
  render(description, { selected = -1, interactive = true } = {}) {
    if (!this.#built || this.#orderChanged(description)) {
      this.#build(description);
    }
    this.#root.classList.toggle("is-static", !interactive);

    for (const cell of description.cells) {
      const button = this.#cells.get(cell.square);
      if (!button) {
        continue;
      }
      button.className = cellClassName(cell);
      button.setAttribute("aria-label", cell.label);
      button.setAttribute("aria-selected", String(cell.isSelected));
      button.tabIndex = cell.square === (selected === -1 ? this.#focusedSquare : selected) ? 0 : -1;
      this.#paintPiece(button, cell);
      this.#paintCoordinates(button, cell);
    }
  }

  /** @returns {boolean} true when the board is displayed but not playable. */
  isStatic() {
    return this.#root.classList.contains("is-static");
  }

  /**
   * Moves keyboard focus to a square.
   *
   * @param {number} square
   */
  focus(square) {
    this.#cells.get(square)?.focus({ preventScroll: true });
  }

  /**
   * @param {BoardDescription} description
   * @returns {boolean} true when the display order no longer matches the DOM.
   */
  #orderChanged(description) {
    const firstCell = this.#root.querySelector("[data-square]");
    if (!firstCell || !description.cells[0]) {
      return true;
    }
    return Number(firstCell.getAttribute("data-square")) !== description.cells[0].square;
  }

  /**
   * @param {BoardDescription} description
   */
  #build(description) {
    this.#root.replaceChildren();
    this.#cells.clear();
    this.#root.setAttribute("role", "grid");
    this.#root.setAttribute("aria-label", "Chess board");
    this.#root.dataset.flipped = String(description.flipped);

    for (const cell of description.cells) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.square = String(cell.square);
      button.setAttribute("role", "gridcell");
      button.className = cellClassName(cell);

      const piece = document.createElement("span");
      piece.className = "piece";
      piece.setAttribute("aria-hidden", "true");
      button.append(piece);

      this.#root.append(button);
      this.#cells.set(cell.square, button);
    }
    this.#built = true;
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {BoardCell} cell
   */
  #paintPiece(button, cell) {
    const piece = button.firstElementChild;
    if (!piece) {
      return;
    }
    const glyph = cell.glyph;
    if (piece.textContent !== glyph) {
      piece.textContent = glyph;
    }
    piece.className = cell.piece ? `piece ${isWhitePiece(cell.piece) ? "piece-white" : "piece-black"}` : "piece";
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {BoardCell} cell
   */
  #paintCoordinates(button, cell) {
    const wanted = `${cell.fileLabel}|${cell.rankLabel}`;
    if (button.dataset.coords === wanted) {
      return;
    }
    button.dataset.coords = wanted;
    button.querySelectorAll(".coord").forEach((element) => element.remove());

    if (cell.rankLabel) {
      const rank = document.createElement("span");
      rank.className = "coord coord-rank";
      rank.textContent = cell.rankLabel;
      rank.setAttribute("aria-hidden", "true");
      button.append(rank);
    }
    if (cell.fileLabel) {
      const file = document.createElement("span");
      file.className = "coord coord-file";
      file.textContent = cell.fileLabel;
      file.setAttribute("aria-hidden", "true");
      button.append(file);
    }
  }

  /**
   * @param {Event} event
   * @returns {number|null} the square index behind a DOM event.
   */
  #squareFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }
    const button = target.closest("[data-square]");
    if (!button || !this.#root.contains(button)) {
      return null;
    }
    const square = Number(button.getAttribute("data-square"));
    return Number.isInteger(square) ? square : null;
  }

  /**
   * Arrow keys move focus around the board; Enter/Space activate a square.
   *
   * @param {KeyboardEvent} event
   */
  #onKeyDown(event) {
    const square = this.#squareFromEvent(event);
    if (square === null) {
      return;
    }

    const flipped = this.#root.dataset.flipped === "true";
    const fileStep = flipped ? -1 : 1;
    const rankStep = flipped ? -1 : 1;
    const moves = {
      ArrowLeft: [-fileStep, 0],
      ArrowRight: [fileStep, 0],
      ArrowUp: [0, rankStep],
      ArrowDown: [0, -rankStep],
    };

    const delta = moves[/** @type {keyof typeof moves} */ (event.key)];
    if (delta) {
      event.preventDefault();
      const next = toIndex(fileOf(square) + delta[0], rankOf(square) + delta[1]);
      if (next !== -1) {
        this.focus(next);
      }
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && !this.isStatic()) {
      event.preventDefault();
      this.#onSelect(square);
    }
  }
}

/**
 * @param {BoardCell} cell
 * @returns {string} the class list for a square.
 */
export function cellClassName(cell) {
  const classes = ["square", cell.isLight ? "square-light" : "square-dark"];
  if (cell.isSelected) {
    classes.push("is-selected");
  }
  if (cell.isTarget) {
    classes.push(cell.isCapture ? "is-capture" : "is-target");
  }
  if (cell.isLastMove) {
    classes.push("is-last-move");
  }
  if (cell.isCheck) {
    classes.push("is-check");
  }
  if (cell.piece) {
    classes.push(isWhitePiece(cell.piece) ? "has-white" : "has-black");
  }
  return classes.join(" ");
}

/**
 * @param {BoardCell} cell
 * @returns {string} a short description used by the status line.
 */
export function describePiece(cell) {
  if (!cell.piece) {
    return "empty square";
  }
  return `${colorOf(cell.piece) === "w" ? "White" : "Black"} ${PIECE_NAMES[cell.piece.toLowerCase()]}`;
}

/**
 * @param {string} uci
 * @returns {{from: number, to: number}|null} the squares of a UCI move.
 */
export function squaresOfUci(uci) {
  const parsed = parseUci(uci);
  return parsed ? { from: parsed.from, to: parsed.to } : null;
}
