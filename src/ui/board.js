/**
 * Board rendering — v2 with drag & drop, hover preview, animations, sounds,
 * board themes, high-contrast, and hint arrow.
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
 * @property {boolean} isHover hover preview
 * @property {string} fileLabel coordinate label, `''` when disabled.
 * @property {string} rankLabel coordinate label, `''` when disabled.
 * @property {string} label accessible description.
 */

/**
 * @typedef {object} BoardDescription
 * @property {BoardCell[][]} rows rows in display order (top row first).
 * @property {BoardCell[]} cells all 64 cells in display order.
 * @property {boolean} flipped
 * @property {{from:number,to:number}|null} [lastMove]
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
 * @param {boolean} [input.showLastMove]
 * @param {number} [input.hoverSquare] square currently hovered
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
  showLastMove = true,
  hoverSquare = -1,
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
      const isLastMoveSquare =
        showLastMove && lastMove !== null && (square === lastMove.from || square === lastMove.to);

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
        isHover: square === hoverSquare,
        fileLabel: showCoordinates && rank === (flipped ? 7 : 0) ? FILES[file] : "",
        rankLabel: showCoordinates && file === (flipped ? 7 : 0) ? RANKS[rank] : "",
        label: describeCell({ name, piece, isTarget, isSelected: square === selected, showLegalTargets }),
      };
      row.push(cell);
    }
    rows.push(row);
  }

  return { rows, cells: rows.flat(), flipped, lastMove };
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
  /** @type {(from:number,to:number)=>void} */
  #onDrop;
  #built = false;
  #focusedSquare = -1;
  #hoverSquare = -1;
  #dragState = null;
  #suppressClick = false;
  #lastMove = null;
  #animationEnabled = true;
  #reducedMotion = false;
  #previousPieces = null;
  #flightCleanup = [];
  #ghost = null;

  /**
   * @param {HTMLElement} root container that receives the 8x8 grid.
   * @param {object} options
   * @param {(square: number) => void} options.onSelect called when a square is activated.
   * @param {(from:number,to:number)=>void} [options.onDrop] called on drag drop
   * @param {boolean} [options.animationEnabled]
   */
  constructor(root, { onSelect, onDrop = null, animationEnabled = true } = {}) {
    this.#root = root;
    this.#onSelect = onSelect;
    this.#onDrop = onDrop || onSelect;
    this.#animationEnabled = animationEnabled;

    // Click for activation without preceding pointer events (keyboard,
    // assistive tech). Pointer taps/drags are handled in #onPointerUp, which
    // claims the compatibility `click` that always follows them.
    this.#root.addEventListener("click", (event) => {
      if (this.#suppressClick) {
        this.#suppressClick = false;
        return;
      }
      if (this.isStatic()) {
        return;
      }
      const square = this.#squareFromEvent(event);
      if (square !== null) {
        this.#onSelect(square);
      }
    });

    // Pointer events for drag & drop + hover
    this.#root.addEventListener("pointerdown", (event) => this.#onPointerDown(event));
    this.#root.addEventListener("pointermove", (event) => this.#onPointerMove(event));
    this.#root.addEventListener("pointerup", (event) => this.#onPointerUp(event));
    this.#root.addEventListener("pointercancel", () => this.#endDrag());
    this.#root.addEventListener("pointerenter", (event) => this.#onPointerEnter(event), true);
    this.#root.addEventListener("pointerleave", (event) => this.#onPointerLeave(event), true);

    // Prevent native drag
    this.#root.addEventListener("dragstart", (event) => event.preventDefault());

    this.#root.addEventListener("keydown", (event) => this.#onKeyDown(event));
    this.#root.addEventListener("focusin", (event) => {
      const square = this.#squareFromEvent(event);
      if (square !== null) {
        this.#focusedSquare = square;
      }
    });

    // Respect reduced motion
    try {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.#reducedMotion = media.matches;
      media.addEventListener?.("change", (e) => {
        this.#reducedMotion = e.matches;
      });
    } catch {
      // ignore
    }
  }

  /**
   * Renders a board description, creating the grid on first use.
   *
   * @param {BoardDescription} description
   * @param {object} [options]
   * @param {number} [options.selected]
   * @param {boolean} [options.interactive] whether cells accept input.
   * @param {{from:number,to:number}|null} [options.hint] hint arrow
   * @param {boolean} [options.animationsEnabled]
   */
  render(description, { selected = -1, interactive = true, hint = null, animationsEnabled = true } = {}) {
    const orderChanged = !this.#built || this.#orderChanged(description);
    if (orderChanged) {
      this.#flightCleanup.forEach((cleanup) => cleanup());
      this.#flightCleanup = [];
      this.#build(description);
    }
    this.#root.classList.toggle("is-static", !interactive);
    const prior = this.#previousPieces;
    const move = description.lastMove;
    const moved =
      !orderChanged &&
      prior &&
      move &&
      prior.get(move.from) &&
      (!this.#lastMove || this.#lastMove.from !== move.from || this.#lastMove.to !== move.to);
    this.#lastMove = move;

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

    this.#previousPieces = new Map(description.cells.map((cell) => [cell.square, cell.piece]));
    if (moved && animationsEnabled && this.#animationEnabled && !this.#reducedMotion) {
      this.#animateMove(move, prior, description);
    }
    // Hint arrow
    this.#renderHint(hint, description);
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

  #squareAtPointer(event) {
    // Pointer capture sends move/up to the original button. Ask the document
    // what is actually underneath the coordinates (including off-board).
    const hitTest = this.#root.ownerDocument?.elementFromPoint;
    const target =
      typeof hitTest === "function" && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        ? hitTest.call(this.#root.ownerDocument, event.clientX, event.clientY)
        : event.target;
    return this.#squareFromEvent({ target });
  }

  #onPointerDown(event) {
    // A previous gesture whose `click` never arrived (e.g. released
    // off-window) must not swallow the next genuine click.
    this.#suppressClick = false;
    if (this.isStatic()) return;
    if (event.button !== 0) return; // only left click / primary touch
    const square = this.#squareFromEvent(event);
    if (square === null) return;

    const button = this.#cells.get(square);
    if (!button) return;

    // Only start drag if square has a piece
    const hasPiece = button.querySelector(".piece")?.textContent;
    if (!hasPiece) return;

    this.#dragState = {
      from: square,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };

    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    // Create ghost
    this.#createGhost(button, event);
  }

  #onPointerMove(event) {
    if (!this.#dragState) {
      // Hover preview
      const square = this.#squareFromEvent(event);
      if (square !== null && square !== this.#hoverSquare) {
        this.#hoverSquare = square;
        // Add hover class
        for (const [sq, btn] of this.#cells) {
          btn.classList.toggle("is-hover", sq === square);
        }
      }
      return;
    }

    const dx = event.clientX - this.#dragState.startX;
    const dy = event.clientY - this.#dragState.startY;
    if (!this.#dragState.moved && Math.hypot(dx, dy) < 5) {
      return; // not yet dragging
    }
    this.#dragState.moved = true;

    if (this.#ghost) {
      this.#ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    const square = this.#squareAtPointer(event);
    if (square !== null && square !== this.#hoverSquare) {
      this.#hoverSquare = square;
      for (const [sq, btn] of this.#cells) {
        btn.classList.toggle("is-hover", sq === square);
      }
    }
  }

  #onPointerUp(event) {
    if (!this.#dragState) return;

    const from = this.#dragState.from;
    const to = this.#squareAtPointer(event);
    const moved = this.#dragState.moved;

    this.#endDrag();

    // Even an off-board release may generate a click retargeted to the source.
    // Consume it instead of unexpectedly reselecting the dragged piece.
    this.#suppressClick = true;
    if (to === null) return;
    // Claim the compatibility `click` that follows every pointerup, so a tap
    // selects exactly once (instead of select-then-deselect) and a drag
    // doesn't reselect its origin square afterwards.
    if (!moved) {
      // Treat as click
      this.#onSelect(to);
      return;
    }
    if (from !== to) {
      // Drag & drop move
      if (this.#onDrop) {
        // For click-click compatibility, first select from, then drop to
        // But for drag, we can directly call onDrop with from,to
        if (this.#onDrop.length === 2) {
          this.#onDrop(from, to);
        } else {
          // Fallback to existing select logic: select from then to
          this.#onSelect(from);
          // Small delay to allow selection to register
          setTimeout(() => this.#onSelect(to), 0);
        }
      }
    }
  }

  #onPointerEnter(event) {
    const square = this.#squareFromEvent(event);
    if (square !== null) {
      this.#hoverSquare = square;
      this.#cells.get(square)?.classList.add("is-hover");
    }
  }

  #onPointerLeave(event) {
    const square = this.#squareFromEvent(event);
    if (square !== null) {
      this.#cells.get(square)?.classList.remove("is-hover");
      if (this.#hoverSquare === square) {
        this.#hoverSquare = -1;
      }
    }
  }

  #createGhost(button, event) {
    this.#removeGhost();
    const piece = button.querySelector(".piece");
    if (!piece) return;

    const ghost = document.createElement("div");
    ghost.className = "piece-ghost";
    ghost.textContent = piece.textContent;
    ghost.style.position = "fixed";
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "1000";
    ghost.style.fontSize = "42px";
    ghost.style.transform = "translate(-50%, -50%)";
    ghost.setAttribute("aria-hidden", "true");

    document.body.append(ghost);
    this.#ghost = ghost;
  }

  #removeGhost() {
    if (this.#ghost) {
      this.#ghost.remove();
      this.#ghost = null;
    }
  }

  #endDrag() {
    this.#removeGhost();
    this.#dragState = null;
    // Clear hover
    for (const btn of this.#cells.values()) {
      btn.classList.remove("is-hover");
    }
    this.#hoverSquare = -1;
  }

  #animateMove(move, prior, description) {
    this.#flightCleanup.forEach((cleanup) => cleanup());
    this.#flightCleanup = [];
    const mover = prior.get(move.from);
    if (!mover) return;
    // The board grid is already painted; overlay only the moving pieces. The
    // destination is hidden during the flight, then revealed. Focus and input
    // stay on the 64 stable button nodes, never on an animation overlay.
    this.#fly(move.from, move.to, mover);
    const captured = prior.get(move.to);
    if (captured) this.#fadeCapture(move.to, captured);
    // An en-passant capture removes the pawn beside the destination.
    if (mover.toLowerCase() === "p" && !captured && fileOf(move.from) !== fileOf(move.to)) {
      const square = toIndex(fileOf(move.to), rankOf(move.from));
      if (prior.get(square) && !description.cells.find((cell) => cell.square === square)?.piece) {
        this.#fadeCapture(square, prior.get(square));
      }
    }
    if (mover.toLowerCase() === "k" && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
      const rank = rankOf(move.from);
      const kingSide = fileOf(move.to) > fileOf(move.from);
      this.#fly(
        toIndex(kingSide ? 7 : 0, rank),
        toIndex(kingSide ? 5 : 3, rank),
        prior.get(toIndex(kingSide ? 7 : 0, rank)),
      );
    }
  }

  #flightNode(square, glyph) {
    const button = this.#cells.get(square);
    if (!button || !glyph) return null;
    const boardRect = this.#root.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const node = document.createElement("span");
    node.className = `piece-flight ${isWhitePiece(glyph) ? "piece-white" : "piece-black"}`;
    node.textContent = PIECE_GLYPHS[glyph] || "";
    node.style.left = `${rect.left - boardRect.left}px`;
    node.style.top = `${rect.top - boardRect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
    node.setAttribute("aria-hidden", "true");
    this.#root.append(node);
    return node;
  }

  #fly(from, to, glyph) {
    const start = this.#cells.get(from);
    const end = this.#cells.get(to);
    if (!start || !end || !glyph) return;
    const node = this.#flightNode(from, glyph);
    if (!node) return;
    const realPiece = end.firstElementChild;
    if (realPiece) realPiece.style.opacity = "0";
    const startRect = start.getBoundingClientRect();
    const endRect = end.getBoundingClientRect();
    const dx = endRect.left - startRect.left;
    const dy = endRect.top - startRect.top;
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      node.remove();
      if (realPiece) realPiece.style.opacity = "";
    };
    this.#flightCleanup.push(cleanup);
    if (typeof node.animate === "function") {
      node
        .animate([{ transform: "translate(0, 0)" }, { transform: `translate(${dx}px, ${dy}px)` }], {
          duration: 180,
          easing: "ease-out",
        })
        .finished.then(cleanup, cleanup);
    } else {
      node.style.transition = "transform 180ms ease-out";
      window.setTimeout(() => {
        node.style.transform = `translate(${dx}px, ${dy}px)`;
      }, 0);
      window.setTimeout(cleanup, 190);
    }
  }

  #fadeCapture(square, glyph) {
    const node = this.#flightNode(square, glyph);
    if (!node) return;
    const cleanup = () => node.remove();
    this.#flightCleanup.push(cleanup);
    if (typeof node.animate === "function") {
      node
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, easing: "ease-out" })
        .finished.then(cleanup, cleanup);
    } else {
      node.style.transition = "opacity 130ms ease-out";
      window.setTimeout(() => {
        node.style.opacity = "0";
      }, 0);
      window.setTimeout(cleanup, 140);
    }
  }

  #renderHint(hint, description) {
    // Remove existing hint
    this.#root.querySelectorAll(".hint-arrow").forEach((el) => el.remove());
    if (!hint) return;

    const fromBtn = this.#cells.get(hint.from);
    const toBtn = this.#cells.get(hint.to);
    if (!fromBtn || !toBtn) return;

    // Create SVG arrow overlay
    const svgNS = "http://www.w3.org/2000/svg";
    let svg = this.#root.querySelector(".board-hints");
    if (!svg) {
      svg = document.createElementNS(svgNS, "svg");
      svg.classList.add("board-hints");
      svg.setAttribute("viewBox", "0 0 8 8");
      svg.style.position = "absolute";
      svg.style.top = "0";
      svg.style.left = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.pointerEvents = "none";
      svg.style.zIndex = "5";
      this.#root.style.position = "relative";
      this.#root.append(svg);
    }

    const fromFile = fileOf(hint.from);
    const fromRank = rankOf(hint.from);
    const toFile = fileOf(hint.to);
    const toRank = rankOf(hint.to);

    const flipped = description.flipped;
    const fromX = flipped ? 7 - fromFile + 0.5 : fromFile + 0.5;
    const fromY = flipped ? fromRank + 0.5 : 7 - fromRank + 0.5;
    const toX = flipped ? 7 - toFile + 0.5 : toFile + 0.5;
    const toY = flipped ? toRank + 0.5 : 7 - toRank + 0.5;

    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", String(fromX));
    line.setAttribute("y1", String(fromY));
    line.setAttribute("x2", String(toX));
    line.setAttribute("y2", String(toY));
    line.setAttribute("stroke", "rgba(113,183,255,0.9)");
    line.setAttribute("stroke-width", "0.2");
    line.setAttribute("marker-end", "url(#arrowhead)");
    line.classList.add("hint-arrow");

    // Arrowhead marker
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(svgNS, "defs");
      const marker = document.createElementNS(svgNS, "marker");
      marker.setAttribute("id", "arrowhead");
      marker.setAttribute("markerWidth", "4");
      marker.setAttribute("markerHeight", "3");
      marker.setAttribute("refX", "3");
      marker.setAttribute("refY", "1.5");
      marker.setAttribute("orient", "auto");
      const polygon = document.createElementNS(svgNS, "polygon");
      polygon.setAttribute("points", "0 0, 4 1.5, 0 3");
      polygon.setAttribute("fill", "rgba(113,183,255,0.9)");
      marker.append(polygon);
      defs.append(marker);
      svg.append(defs);
    }

    svg.append(line);
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
  if (cell.isHover) {
    classes.push("is-hover");
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
