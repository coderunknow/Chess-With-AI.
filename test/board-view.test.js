import assert from "node:assert/strict";
import test from "node:test";

import { Position } from "../src/core/position.js";
import { parseSquare, toName } from "../src/core/squares.js";
import { cellClassName, describeBoard, squaresOfUci } from "../src/ui/board.js";
import { GameSession } from "../src/ui/game.js";

/**
 * @param {object} [options]
 * @returns {import("../src/ui/board.js").BoardDescription}
 */
function boardOf(options = {}) {
  return describeBoard({ position: Position.start(), ...options });
}

test("a board description always contains 64 cells", () => {
  const description = boardOf();
  assert.equal(description.cells.length, 64);
  assert.equal(description.rows.length, 8);
  assert.equal(new Set(description.cells.map((cell) => cell.square)).size, 64);
});

test("the default orientation puts a8 top-left and h1 bottom-right", () => {
  const { rows, cells } = boardOf();
  assert.equal(cells[0].name, "a8");
  assert.equal(cells[7].name, "h8");
  assert.equal(cells[56].name, "a1");
  assert.equal(cells[63].name, "h1");
  assert.equal(rows[7][7].name, "h1");
});

test("the flipped orientation puts h1 top-left and a8 bottom-right", () => {
  const { cells, flipped } = boardOf({ flipped: true });
  assert.equal(flipped, true);
  assert.equal(cells[0].name, "h1");
  assert.equal(cells[7].name, "a1");
  assert.equal(cells[56].name, "h8");
  assert.equal(cells[63].name, "a8");
});

test("square colours follow the a1-is-dark rule", () => {
  const cells = new Map(boardOf().cells.map((cell) => [cell.name, cell]));
  assert.equal(cells.get("a1").isLight, false);
  assert.equal(cells.get("h1").isLight, true);
  assert.equal(cells.get("a8").isLight, true);
  assert.equal(cells.get("h8").isLight, false);
  assert.equal(cells.get("e4").isLight, true);
});

test("pieces are rendered as glyphs with an accessible description", () => {
  const cells = new Map(boardOf().cells.map((cell) => [cell.name, cell]));
  assert.equal(cells.get("e1").piece, "K");
  assert.equal(cells.get("e1").glyph, "\u2654");
  assert.equal(cells.get("e1").label, "e1, white king");
  assert.equal(cells.get("d8").glyph, "\u265B");
  assert.equal(cells.get("d8").label, "d8, black queen");
  assert.equal(cells.get("e4").piece, "");
  assert.equal(cells.get("e4").label, "e4, empty");
});

test("an empty board renders no pieces", () => {
  const description = describeBoard({
    position: Position.fromFen("8/8/8/4k3/8/8/8/4K3 w - - 0 1", { strict: false }),
  });
  assert.equal(description.cells.filter((cell) => cell.piece).length, 2);
});

test("selection, targets, last move and check are flagged", () => {
  const session = new GameSession();
  session.playHumanMove("e2e4");

  const description = describeBoard({
    position: session.position,
    selected: parseSquare("e4"),
    targets: session.legalTargets(parseSquare("e4")),
    lastMove: squaresOfUci(session.lastMove.uci),
  });
  const cells = new Map(description.cells.map((cell) => [cell.name, cell]));

  assert.equal(cells.get("e4").isSelected, true);
  assert.equal(cells.get("e4").isLastMove, true);
  assert.equal(cells.get("e2").isLastMove, true);
  assert.equal(cells.get("e5").isTarget, true);
  assert.equal(cells.get("e5").isCapture, false);
  assert.equal(cells.get("d2").isSelected, false);
  assert.match(cells.get("e5").label, /legal move$/);
  assert.match(cells.get("e4").label, /selected/);
});

test("capture targets are distinguished from quiet moves", () => {
  const position = Position.fromFen("4k3/8/8/4p3/3P4/8/8/4K3 w - - 0 1", { strict: false });
  const description = describeBoard({
    position,
    selected: parseSquare("d4"),
    targets: ["e5"],
  });
  const capture = description.cells.find((cell) => cell.name === "e5");
  assert.equal(capture.isCapture, true);
  assert.match(cellClassName(capture), /is-capture/);
});

test("the king square is flagged when the side to move is in check", () => {
  const position = Position.fromFen("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1", { strict: false });
  assert.equal(position.isCheck(), true);

  const description = describeBoard({ position });
  const king = description.cells.find((cell) => cell.name === "e1");
  const rook = description.cells.find((cell) => cell.name === "e2");
  assert.equal(king.isCheck, true);
  assert.equal(rook.isCheck, false);
  assert.match(cellClassName(king), /is-check/);
});

test("coordinate labels only appear on the edges", () => {
  const { cells } = boardOf({ showCoordinates: true });
  const labelled = cells.filter((cell) => cell.fileLabel || cell.rankLabel);
  assert.equal(labelled.length, 15, "eight file labels plus eight rank labels, sharing one corner");

  // Files are labelled along the bottom row (rank 1), ranks along the left column (a-file).
  const corners = new Map(cells.map((cell) => [cell.name, cell]));
  assert.equal(corners.get("a1").fileLabel, "a");
  assert.equal(corners.get("a1").rankLabel, "1");
  assert.equal(corners.get("h1").fileLabel, "h");
  assert.equal(corners.get("h1").rankLabel, "");
  assert.equal(corners.get("a8").fileLabel, "");
  assert.equal(corners.get("a8").rankLabel, "8");
  assert.equal(corners.get("h8").fileLabel, "");
  assert.equal(corners.get("h8").rankLabel, "");
  assert.equal(corners.get("e4").fileLabel, "");
  assert.equal(corners.get("e4").rankLabel, "");

  // Flipped, the bottom row is rank 8 and the left column is the h-file.
  const flipped = describeBoard({ position: Position.start(), flipped: true });
  const flippedCells = new Map(flipped.cells.map((cell) => [cell.name, cell]));
  assert.equal(flippedCells.get("h1").rankLabel, "1");
  assert.equal(flippedCells.get("h1").fileLabel, "");
  assert.equal(flippedCells.get("h8").rankLabel, "8");
  assert.equal(flippedCells.get("h8").fileLabel, "h");
  assert.equal(flippedCells.get("a8").fileLabel, "a");
  assert.equal(flippedCells.get("a8").rankLabel, "");
});

test("coordinates can be hidden", () => {
  const description = boardOf({ showCoordinates: false });
  assert.equal(description.cells.filter((cell) => cell.fileLabel || cell.rankLabel).length, 0);
});

test("class names reflect every visual state", () => {
  const { cells } = boardOf();
  const empty = cells.find((cell) => cell.name === "e4");
  assert.equal(cellClassName(empty), "square square-light");

  const description = describeBoard({
    position: Position.start(),
    selected: parseSquare("g1"),
    targets: ["f3", "h3"],
    lastMove: { from: parseSquare("g1"), to: parseSquare("f3") },
  });
  const knight = description.cells.find((cell) => cell.name === "g1");
  assert.match(cellClassName(knight), /is-selected/);
  assert.match(cellClassName(knight), /has-white/);

  const target = description.cells.find((cell) => cell.name === "f3");
  assert.match(cellClassName(target), /is-target/);
  assert.match(cellClassName(target), /is-last-move/);

  const blackPiece = description.cells.find((cell) => cell.name === "e8");
  assert.match(cellClassName(blackPiece), /has-black/);
});

test("squaresOfUci returns both squares", () => {
  assert.deepEqual(squaresOfUci("e2e4"), { from: parseSquare("e2"), to: parseSquare("e4") });
  assert.deepEqual(squaresOfUci("e7e8q"), { from: parseSquare("e7"), to: parseSquare("e8") });
  assert.equal(squaresOfUci("nonsense"), null);
  assert.equal(toName(squaresOfUci("a1h8").to), "h8");
});

test("the board description follows the position after several moves", () => {
  const session = new GameSession();
  session.playHumanMove("e2e4");
  session.playAiMove("e7e5");
  const cells = new Map(describeBoard({ position: session.position }).cells.map((c) => [c.name, c]));

  assert.equal(cells.get("e2").piece, "");
  assert.equal(cells.get("e4").piece, "P");
  assert.equal(cells.get("e7").piece, "");
  assert.equal(cells.get("e5").piece, "p");
  assert.equal(describeBoard({ position: session.position }).cells.filter((c) => c.piece).length, 32);
});
