import assert from "node:assert/strict";
import test from "node:test";

import { Position } from "../src/core/position.js";
import { parseSquare } from "../src/core/squares.js";
import { BoardView, describeBoard } from "../src/ui/board.js";
import { HistoryView } from "../src/ui/history.js";
import { FakeElement, installFakeDom } from "./helpers/fake-dom.js";

/**
 * Mounts a playable board against the DOM doubles.
 *
 * @returns {{dom: object, root: FakeElement, view: BoardView, selects: number[], drops: number[][], buttonFor: (square: number) => FakeElement}}
 */
function mountBoard({ reducedMotion = false } = {}) {
  const dom = installFakeDom();
  if (reducedMotion) window.matchMedia = () => ({ matches: true });
  const document = dom.document;
  const root = document.createElement("div");
  document.body.append(root);
  const selects = [];
  const drops = [];
  const view = new BoardView(root, {
    onSelect: (square) => selects.push(square),
    onDrop: (from, to) => drops.push([from, to]),
  });
  view.render(describeBoard({ position: Position.start() }), { selected: -1, interactive: true });
  // Fake-DOM queries are registry based: register the piece spans so
  // `#onPointerDown` sees occupied squares like a real browser would.
  // `dataset` is also not reflected to attributes, so mirror `data-square`.
  for (const button of root.children) {
    button.setAttribute("data-square", button.dataset.square);
    dom.register(button, ["[data-square]"]);
    const piece = button.firstElementChild;
    if (piece) {
      dom.register(piece, [".piece"]);
    }
  }
  const buttonFor = (square) => root.children.find((button) => button.dataset.square === String(square));
  return { dom, root, view, selects, drops, buttonFor };
}

/**
 * Dispatches a left-button tap: pointerdown, pointerup, then the compatibility click.
 *
 * @param {FakeElement} root
 * @param {FakeElement} button
 */
function tap(root, button, { x = 100, y = 100 } = {}) {
  root.dispatch("pointerdown", { target: button, button: 0, clientX: x, clientY: y, pointerId: 1 });
  root.dispatch("pointerup", { target: button, button: 0, clientX: x, clientY: y, pointerId: 1 });
  root.dispatch("click", { target: button });
}

test("tapping an occupied square selects it exactly once", () => {
  const env = mountBoard();
  try {
    const e2 = parseSquare("e2");
    tap(env.root, env.buttonFor(e2));
    assert.deepEqual(env.selects, [e2]);
  } finally {
    env.dom.restore();
  }
});

test("dragging a piece drops once and the trailing click reselects nothing", () => {
  const env = mountBoard();
  try {
    const from = parseSquare("g1");
    const to = parseSquare("f3");
    const start = env.buttonFor(from);
    const end = env.buttonFor(to);
    env.root.dispatch("pointerdown", { target: start, button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    env.root.dispatch("pointermove", { target: end, button: 0, clientX: 140, clientY: 60, pointerId: 1 });
    env.root.dispatch("pointerup", { target: end, button: 0, clientX: 140, clientY: 60, pointerId: 1 });
    // With pointer capture the compatibility click retargets to the origin.
    env.root.dispatch("click", { target: start });
    assert.deepEqual(env.drops, [[from, to]]);
    assert.deepEqual(env.selects, []);
  } finally {
    env.dom.restore();
  }
});

test("pointer-captured drag uses the square under release coordinates, not the captured source", () => {
  const env = mountBoard();
  try {
    const from = parseSquare("g1");
    const to = parseSquare("f3");
    const start = env.buttonFor(from);
    const end = env.buttonFor(to);
    env.dom.document.elementFromPoint = () => end;
    env.root.dispatch("pointerdown", { target: start, button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    env.root.dispatch("pointermove", { target: start, clientX: 140, clientY: 60, pointerId: 1 });
    env.root.dispatch("pointerup", { target: start, clientX: 140, clientY: 60, pointerId: 1 });
    env.root.dispatch("click", { target: start });
    assert.deepEqual(env.drops, [[from, to]]);
    assert.deepEqual(env.selects, []);
  } finally {
    env.dom.restore();
  }
});

test("an off-board release does not select the captured source on the trailing click", () => {
  const env = mountBoard();
  try {
    const start = env.buttonFor(parseSquare("g1"));
    env.dom.document.elementFromPoint = () => env.dom.document.body;
    env.root.dispatch("pointerdown", { target: start, button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    env.root.dispatch("pointermove", { target: start, clientX: 140, clientY: 60, pointerId: 1 });
    env.root.dispatch("pointerup", { target: start, clientX: 140, clientY: 60, pointerId: 1 });
    env.root.dispatch("click", { target: start });
    assert.deepEqual(env.drops, []);
    assert.deepEqual(env.selects, []);
  } finally {
    env.dom.restore();
  }
});

test("tapping an empty square still activates it through the click path", () => {
  const env = mountBoard();
  try {
    const e4 = parseSquare("e4");
    tap(env.root, env.buttonFor(e4));
    assert.deepEqual(env.selects, [e4]);
  } finally {
    env.dom.restore();
  }
});

test("a click without preceding pointer events is still honoured", () => {
  const env = mountBoard();
  try {
    const e2 = parseSquare("e2");
    env.root.dispatch("click", { target: env.buttonFor(e2) });
    assert.deepEqual(env.selects, [e2]);
  } finally {
    env.dom.restore();
  }
});

function recordAnimations(document) {
  const originalCreate = document.createElement;
  const animations = [];
  document.createElement = (...args) => {
    const element = originalCreate(...args);
    element.animate = (frames, options) => {
      let finish;
      const finished = new Promise((resolve) => {
        finish = resolve;
      });
      animations.push({ element, frames, options, finish });
      return { finished };
    };
    return element;
  };
  return animations;
}

function flightNodes(root) {
  return root.children.filter((child) => child.classList.contains("piece-flight"));
}

function playAndRender(env, position, uci, animationsEnabled = true) {
  const move = position.moveFromUci(uci);
  assert.ok(move, `${uci} must be legal in the test position`);
  position.makeMove(move);
  env.view.render(
    describeBoard({
      position,
      lastMove: { from: move.from, to: move.to },
    }),
    { animationsEnabled },
  );
}

test("a move glides once on the same stable square nodes and reveals its destination on completion", async () => {
  const env = mountBoard();
  try {
    const animations = recordAnimations(env.dom.document);
    const destination = env.buttonFor(parseSquare("e4"));
    const position = Position.start();
    playAndRender(env, position, "e2e4");
    assert.equal(animations.length, 1);
    assert.equal(animations[0].options.duration, 180);
    assert.equal(flightNodes(env.root).length, 1);
    assert.equal(env.buttonFor(parseSquare("e4")), destination, "animation never replaces the focusable square");
    assert.equal(destination.firstElementChild.style.opacity, "0");
    animations[0].finish();
    await Promise.resolve();
    assert.equal(flightNodes(env.root).length, 0);
    assert.equal(destination.firstElementChild.style.opacity, "");
    env.view.render(describeBoard({ position, lastMove: { from: parseSquare("e2"), to: parseSquare("e4") } }));
    assert.equal(animations.length, 1, "a status-only render cannot replay the same animation");
  } finally {
    env.dom.restore();
  }
});

test("captures fade, castling moves both pieces, and en passant fades the off-target pawn", () => {
  const env = mountBoard();
  try {
    const animations = recordAnimations(env.dom.document);
    const renderPosition = (fen) => {
      const position = Position.fromFen(fen);
      env.view.render(describeBoard({ position }));
      return position;
    };
    let position = renderPosition("4k3/8/8/4p3/3P4/8/8/4K3 w - - 0 1");
    playAndRender(env, position, "d4e5");
    assert.equal(flightNodes(env.root).length, 2, "capturer glides and captured pawn fades");
    assert.ok(animations.some((entry) => entry.options.duration === 130));

    position = renderPosition("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
    playAndRender(env, position, "e1g1");
    assert.equal(flightNodes(env.root).length, 2, "castling animates king and rook");
    assert.equal(animations.filter((entry) => entry.options.duration === 180).length, 3);

    position = renderPosition("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
    playAndRender(env, position, "e5d6");
    assert.equal(flightNodes(env.root).length, 2, "en passant fades the pawn on d5, not on d6");
    assert.equal(flightNodes(env.root)[1].textContent, "♟");
  } finally {
    env.dom.restore();
  }
});

test("disabled or reduced-motion animations paint instantly with no hidden piece", () => {
  for (const reducedMotion of [false, true]) {
    const env = mountBoard({ reducedMotion });
    try {
      const animations = recordAnimations(env.dom.document);
      const position = Position.start();
      playAndRender(env, position, "e2e4", !reducedMotion ? false : true);
      assert.equal(animations.length, 0);
      assert.equal(flightNodes(env.root).length, 0);
      assert.notEqual(env.buttonFor(parseSquare("e4")).firstElementChild.style.opacity, "0");
    } finally {
      env.dom.restore();
    }
  }
});

/**
 * @param {object} options
 * @returns {import("../src/ui/game.js").MoveEntry} a minimal history entry.
 */
function moveEntry({ uci, san, color = "w", source = "human" }) {
  return {
    uci,
    san,
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.slice(4),
    color,
    source,
    fenAfter: "fen",
    check: false,
    mate: false,
  };
}

/**
 * Mounts a move list whose "current row" is a stable stub below the fold.
 *
 * @returns {{dom: object, list: FakeElement, view: HistoryView, current: FakeElement}}
 */
function mountHistory() {
  const dom = installFakeDom();
  const document = dom.document;
  const list = document.createElement("ol");
  const empty = document.createElement("p");
  document.body.append(list);
  const view = new HistoryView({ list, empty, onSelectPly: null });
  const current = new FakeElement("li");
  current.ownerDocument = document;
  current.getBoundingClientRect = () => ({ top: 500, bottom: 520, left: 0, right: 120, width: 120, height: 20 });
  list.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 120, width: 120, height: 100 });
  list.querySelector = (selector) => (String(selector).includes("history-row") ? current : null);
  list.scrollTop = 0;
  return { dom, list, view, current };
}

test("re-rendering an unchanged move list touches no scrolling at all", () => {
  const env = mountHistory();
  try {
    const history = [moveEntry({ uci: "e2e4", san: "e4" })];
    const options = { startMoveNumber: 1, firstMover: "w", currentPly: 1 };
    env.view.render(history, options);

    let pageScrolls = 0;
    env.current.scrollIntoView = () => {
      pageScrolls += 1;
    };
    env.list.scrollTop = 0;

    // A selection-only re-render: same moves, same cursor — exactly what every
    // square click triggers through App#render.
    env.view.render(history, options);
    assert.equal(pageScrolls, 0, "must not scroll the page on a selection-only render");
    assert.equal(env.list.scrollTop, 0, "must not move the list either");
  } finally {
    env.dom.restore();
  }
});

test("a new move scrolls only the move-list container, never the page", () => {
  const env = mountHistory();
  try {
    const first = [moveEntry({ uci: "e2e4", san: "e4" })];
    env.view.render(first, { startMoveNumber: 1, firstMover: "w", currentPly: 1 });

    let pageScrolls = 0;
    env.current.scrollIntoView = () => {
      pageScrolls += 1;
    };
    env.list.scrollTop = 0;

    const history = [...first, moveEntry({ uci: "e7e5", san: "e5", color: "b", source: "ai" })];
    env.view.render(history, { startMoveNumber: 1, firstMover: "w", currentPly: 2 });
    assert.equal(pageScrolls, 0, "must never scroll the side-panel document");
    assert.equal(env.list.scrollTop, 420, "the list container scrolls just enough to reveal the row");
  } finally {
    env.dom.restore();
  }
});
