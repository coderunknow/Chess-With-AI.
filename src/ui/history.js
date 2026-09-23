/**
 * Move-list rendering.
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
 */

/**
 * @param {ReadonlyArray<import('./game.js').MoveEntry>} history
 * @param {object} [options]
 * @param {number} [options.startMoveNumber] defaults to 1.
 * @param {'w'|'b'} [options.firstMover] colour of the first ply, defaults to White.
 * @returns {HistoryRow[]} rows in game order.
 */
export function describeHistory(history, { startMoveNumber = 1, firstMover = Color.WHITE } = {}) {
  /** @type {HistoryRow[]} */
  const rows = [];
  const last = history.length - 1;
  let moveNumber = startMoveNumber;

  if (firstMover === Color.BLACK && history.length > 0) {
    rows.push({ number: moveNumber, white: null, black: history[0], isCurrent: last === 0 });
    moveNumber += 1;
  }

  let index = firstMover === Color.BLACK ? 1 : 0;
  while (index < history.length) {
    const white = history[index];
    const black = history[index + 1] || null;
    rows.push({
      number: moveNumber,
      white,
      black,
      isCurrent: index === last || index + 1 === last,
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

  /**
   * @param {object} options
   * @param {HTMLElement} options.list element that receives the rows.
   * @param {HTMLElement} options.empty element shown while the list is empty.
   */
  constructor({ list, empty }) {
    this.#root = list;
    this.#emptyState = empty;
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
      item.className = `history-row${row.isCurrent ? " is-current" : ""}`;

      const number = document.createElement("span");
      number.className = "history-number";
      number.textContent = `${row.number}.`;
      item.append(number);

      item.append(createMoveCell(row.white, "white move"));
      item.append(createMoveCell(row.black, "black move"));
      fragment.append(item);
    }

    this.#root.replaceChildren(fragment);
    const current = this.#root.querySelector(".history-row.is-current");
    current?.scrollIntoView({ block: "nearest" });
  }
}

/**
 * @param {import('./game.js').MoveEntry|null} entry
 * @param {string} description
 * @returns {HTMLSpanElement} a move cell.
 */
function createMoveCell(entry, description) {
  const cell = document.createElement("span");
  cell.className = "history-move";
  if (!entry) {
    cell.classList.add("is-empty");
    cell.textContent = "…";
    cell.setAttribute("aria-label", `${description}: not played`);
    return cell;
  }

  cell.classList.add(entry.source === "ai" ? "is-ai" : "is-human");
  cell.textContent = entry.san;
  cell.title = `${entry.uci}${entry.mate ? " (checkmate)" : entry.check ? " (check)" : ""}`;
  cell.setAttribute("aria-label", `${description}: ${entry.san}`);
  return cell;
}
