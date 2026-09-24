/**
 * Move-list rendering — v2 with replay viewer, comments, classification.
 *
 * `describeHistory` is a pure function (unit-tested without a browser) that
 * groups plies into numbered rows; `HistoryView` paints them.
 *
 * @module ui/history
 */

import { Color } from "../core/pieces.js";

/**
 * @typedef {object} HistoryRow
 * @property {number} number fullmove number.
 * @property {import('./game.js').MoveEntry|null} white
 * @property {import('./game.js').MoveEntry|null} black
 * @property {boolean} isCurrent row contains the latest move.
 * @property {boolean} isReplayCurrent row contains the replay cursor.
 * @property {number} whitePly ply index for white move (0-based)
 * @property {number} blackPly ply index for black move
 */

/**
 * @param {ReadonlyArray<import('./game.js').MoveEntry>} history
 * @param {object} [options]
 * @param {number} [options.startMoveNumber] defaults to 1.
 * @param {'w'|'b'} [options.firstMover] colour of the first ply, defaults to White.
 * @param {number} [options.currentPly] replay cursor, defaults to history.length
 * @returns {HistoryRow[]} rows in game order.
 */
export function describeHistory(
  history,
  { startMoveNumber = 1, firstMover = Color.WHITE, currentPly = history.length } = {},
) {
  /** @type {HistoryRow[]} */
  const rows = [];
  const last = history.length - 1;
  let moveNumber = startMoveNumber;

  if (firstMover === Color.BLACK && history.length > 0) {
    rows.push({
      number: moveNumber,
      white: null,
      black: history[0],
      isCurrent: last === 0,
      isReplayCurrent: currentPly === 1,
      whitePly: -1,
      blackPly: 0,
    });
    moveNumber += 1;
  }

  let index = firstMover === Color.BLACK ? 1 : 0;
  while (index < history.length) {
    const white = history[index];
    const black = history[index + 1] || null;
    const whitePly = index;
    const blackPly = index + 1;
    rows.push({
      number: moveNumber,
      white,
      black,
      isCurrent: index === last || index + 1 === last,
      isReplayCurrent: currentPly === whitePly + 1 || (black && currentPly === blackPly + 1),
      whitePly,
      blackPly: black ? blackPly : -1,
    });
    moveNumber += 1;
    index += 2;
  }

  return rows;
}

export class HistoryView {
  /** @type {HTMLElement} */
  #root;
  /** @type {HTMLElement} */
  #emptyState;
  /** @type {(ply:number)=>void} */
  #onSelectPly;
  /** @type {string|null} move-list signature of the last auto-scroll. */
  #lastScrollKey = null;

  /**
   * @param {object} options
   * @param {HTMLElement} options.list element that receives the rows.
   * @param {HTMLElement} options.empty element shown while the list is empty.
   * @param {(ply:number)=>void} [options.onSelectPly] called when a move is clicked
   */
  constructor({ list, empty, onSelectPly = null }) {
    this.#root = list;
    this.#emptyState = empty;
    this.#onSelectPly = onSelectPly;

    if (this.#onSelectPly) {
      this.#root.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const cell = target.closest("[data-ply]");
        if (!cell) return;
        const ply = Number(cell.getAttribute("data-ply"));
        if (Number.isInteger(ply) && ply >= 0) {
          this.#onSelectPly(ply);
        }
      });
    }
  }

  /** @returns {(ply:number)=>void|null} */
  get onSelectPly() {
    return this.#onSelectPly;
  }

  /**
   * @param {ReadonlyArray<import('./game.js').MoveEntry>} history
   * @param {object} [options] forwarded to {@link describeHistory}.
   */
  render(history, options) {
    const rows = describeHistory(history, options);
    this.#emptyState.hidden = rows.length > 0;

    if (rows.length === 0) {
      this.#root.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const item = document.createElement("li");
      item.className = `history-row${row.isCurrent ? " is-current" : ""}${row.isReplayCurrent ? " is-replay-current" : ""}`;

      const number = document.createElement("span");
      number.className = "history-number";
      number.textContent = `${row.number}.`;
      item.append(number);

      item.append(createMoveCell(row.white, "white move", row.whitePly, options.currentPly));
      item.append(createMoveCell(row.black, "black move", row.blackPly, options.currentPly));
      fragment.append(item);
    }

    this.#root.replaceChildren(fragment);
    this.#scrollCurrentRowIntoView(history, options);
  }

  /**
   * Keeps the current row visible inside the move list — and only inside the
   * move list. The DOM scrolling helper that scrolls every ancestor is
   * deliberately avoided here: selecting a piece re-renders the list, so it
   * would nudge the whole side panel downwards whenever the moves sat below
   * the fold. Selection-only re-renders skip scrolling entirely.
   *
   * @param {ReadonlyArray<import('./game.js').MoveEntry>} history
   * @param {object} [options] forwarded to {@link describeHistory}.
   */
  #scrollCurrentRowIntoView(history, options) {
    const currentPly = options?.currentPly ?? history.length;
    const key = `${history.length}:${currentPly}`;
    if (key === this.#lastScrollKey) {
      return;
    }
    this.#lastScrollKey = key;

    const current =
      this.#root.querySelector(".history-row.is-replay-current") || this.#root.querySelector(".history-row.is-current");
    if (!current) {
      return;
    }
    const list = this.#root;
    if (typeof list.scrollTop !== "number") {
      return;
    }
    let listRect;
    let rowRect;
    try {
      listRect = list.getBoundingClientRect();
      rowRect = current.getBoundingClientRect();
    } catch {
      return;
    }
    if (!listRect || !rowRect) {
      return;
    }
    const overflowBottom = rowRect.bottom - listRect.bottom;
    const overflowTop = listRect.top - rowRect.top;
    if (overflowBottom > 0) {
      list.scrollTop += overflowBottom;
    } else if (overflowTop > 0) {
      list.scrollTop -= overflowTop;
    }
  }
}

/**
 * @param {import('./game.js').MoveEntry|null} entry
 * @param {string} description
 * @param {number} ply ply index
 * @param {number} currentPly
 * @returns {HTMLSpanElement} a move cell.
 */
function createMoveCell(entry, description, ply, currentPly) {
  const cell = document.createElement("span");
  cell.className = "history-move";
  if (!entry) {
    cell.classList.add("is-empty");
    cell.textContent = "…";
    cell.setAttribute("aria-label", `${description}: not played`);
    return cell;
  }

  cell.classList.add(entry.source === "ai" ? "is-ai" : "is-human");
  if (entry.classification) {
    cell.classList.add(`is-${entry.classification}`);
  }
  if (ply + 1 === currentPly) {
    cell.classList.add("is-active-ply");
  }

  cell.textContent = entry.san;
  cell.dataset.ply = String(ply + 1);
  cell.title = `${entry.uci}${entry.mate ? " (checkmate)" : entry.check ? " (check)" : ""}${entry.comment ? ` — ${entry.comment}` : ""}${entry.classification ? ` [${entry.classification}]` : ""}`;
  cell.setAttribute(
    "aria-label",
    `${description}: ${entry.san}${entry.classification ? `, ${entry.classification}` : ""}`,
  );
  cell.setAttribute("role", "button");
  cell.tabIndex = 0;

  return cell;
}
