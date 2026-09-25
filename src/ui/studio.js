/**
 * Prompt Studio — a privacy-safe preview of the exact string the send path
 * would dispatch right now for the current position.
 *
 * It imports the SAME builder (`buildTurnPrompt`) as `App`'s send path, so the
 * studio preview and the sent prompt can never diverge. Zero network calls:
 * everything is local string work on data the panel already has.
 *
 * @module ui/studio
 */

import { buildTurnPrompt, describePromptMetrics } from "../shared/prompt.js";

/**
 * @typedef {object} StudioPreview
 * @property {string} text the exact prompt the send path would dispatch.
 * @property {{chars: number, lines: number, overBudget: boolean}} metrics
 * @property {string} platformLabel which pinned platform would receive it.
 * @property {string} style the prompt style shown.
 * @property {number} funSentences the fun-mode slider value shown.
 */

/**
 * Builds the studio preview from the same turn context the send path uses.
 *
 * @param {object} input
 * @param {object} input.context turn context for {@link buildTurnPrompt}.
 * @param {string} [input.platformLabel] label of the receiving platform.
 * @returns {StudioPreview}
 */
export function buildStudioPreview({ context, platformLabel = "" }) {
  const text = buildTurnPrompt(context);
  return {
    text,
    metrics: describePromptMetrics(text),
    platformLabel,
    style: context?.style ?? "standard",
    funSentences: Number(context?.funSentences) || 2,
  };
}
