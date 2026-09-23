/**
 * Search Worker — runs chess search off the main thread.
 *
 * Loaded as `new Worker(new URL('./search-worker.js', import.meta.url), {type:'module'})`
 * in the side panel. Communicates via postMessage.
 *
 * Protocol:
 *   { type: 'search', fen, level, maxDepth, timeLimitMs, id }
 *   -> { type: 'info', id, depth, score, move, nodes }
 *   -> { type: 'result', id, move, score, nodes, depth }
 *   { type: 'stop' }
 *   { type: 'cancel' }
 *
 * Pure, no DOM, no chrome.
 *
 * @module core/search-worker
 */

import { Position } from "./position.js";
import { Searcher } from "./search.js";

// Worker global
const searcher = new Searcher();
let currentId = null;

self.onmessage = async (event) => {
  const data = event.data;
  if (!data || typeof data.type !== "string") return;

  if (data.type === "search") {
    currentId = data.id || "default";
    searcher.stop();
    // Small delay to allow stop
    await new Promise((r) => setTimeout(r, 0));
    searcher.configure({ timeLimitMs: data.timeLimitMs, nodeLimit: data.nodeLimit });

    try {
      const position = Position.fromFen(data.fen);
      const result = searcher.iterativeDeepening(position, {
        maxDepth: data.maxDepth || data.level || 4,
        timeLimitMs: data.timeLimitMs || 2000,
        nodeLimit: data.nodeLimit || 0,
        onInfo: (info) => {
          self.postMessage({
            type: "info",
            id: currentId,
            depth: info.depth,
            score: info.score,
            move: info.move ? { from: info.move.from, to: info.move.to, promotion: info.move.promotion } : null,
            nodes: info.nodes,
          });
        },
      });

      self.postMessage({
        type: "result",
        id: currentId,
        move: result.move
          ? { from: result.move.from, to: result.move.to, promotion: result.move.promotion, flags: result.move.flags }
          : null,
        score: result.score,
        nodes: result.nodes,
        depth: result.depth,
      });
    } catch (error) {
      self.postMessage({ type: "error", id: currentId, error: error.message });
    }
  } else if (data.type === "stop" || data.type === "cancel") {
    searcher.stop();
    self.postMessage({ type: "cancelled", id: currentId });
  } else if (data.type === "ping") {
    self.postMessage({ type: "pong", id: data.id });
  }
};

self.postMessage({ type: "ready" });
