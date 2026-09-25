/**
 * Reply delivery gate — decides WHEN a reply the watcher found may be handed
 * to the panel. Pure state machine (no DOM, no chrome.*), unit-tested.
 *
 * Background (v0.7.2 top bug): v0.7.1 parked any reply of an UNCONFIRMED
 * send in `queuedReply` until a matching user echo was recognised. When the
 * host rendered the echo in a shape the matcher rejected (ChatGPT's turn
 * article, Grok bubbles, a reflowed echo) or rendered no echo at all, the
 * parked reply was stranded forever: the AI had answered, the board never
 * moved.
 *
 * Attribution rule: after ONE submit event, a reply is safely attributable to
 * this request when EITHER
 *  - the matching NEW user echo is observed (`echo()`), OR
 *  - the reply itself sits in a NEW assistant container nominated after the
 *    submit — the watcher only reports such containers (history and
 *    pre-submit bubbles are baselined out), and an assistant turn appearing
 *    after our submit is itself proof the submit landed.
 * The panel still validates the move (request id, pinned tab, legality)
 * before anything touches the board. The gate NEVER submits anything.
 *
 * @module content/reply-gate
 */

/** Gate states. */
export const GateState = Object.freeze({
  /** No live request (never armed, cancelled, paused or failed). */
  IDLE: "idle",
  /** The single submit is being verified; replies wait for the verdict. */
  VERIFYING: "verifying",
  /** Confirmed (or manual): replies are delivered immediately. */
  READY: "ready",
  /** One submit fired but was not confirmed; first attribution opens the gate. */
  AWAITING_ATTRIBUTION: "awaiting-attribution",
});

export class ReplyGate {
  #state = GateState.IDLE;
  /** @type {object|null} */
  #queued = null;
  /** @type {''|'confirmed'|'echo'|'reply'|'manual'} */
  #attribution = "";

  /**
   * @param {object} options
   * @param {(event: object) => void} options.deliver hands a reply to the panel.
   * @param {(attribution: string) => void} [options.onAttributed] fired once
   *   when an unconfirmed send becomes attributable (echo or reply).
   */
  constructor({ deliver, onAttributed = () => {} }) {
    this.deliver = deliver;
    this.onAttributed = onAttributed;
  }

  /** @returns {string} current {@link GateState}. */
  get state() {
    return this.#state;
  }

  /** @returns {object|null} the parked reply, if any. */
  get queued() {
    return this.#queued;
  }

  /** @returns {string} how the live request's reply was attributed. */
  get attribution() {
    return this.#attribution;
  }

  /** A new auto-send request starts: replies wait for the send verdict. */
  begin() {
    this.#state = GateState.VERIFYING;
    this.#queued = null;
    this.#attribution = "";
  }

  /** Confirmed send (or manual mode): deliver now, and flush a fast reply. */
  ready(attribution = "confirmed") {
    this.#state = GateState.READY;
    this.#attribution = attribution;
    this.#flush();
  }

  /**
   * One submit fired but was not confirmed. A reply that already arrived
   * during verification came from a NEW post-submit container, so it is
   * attributable right away — it must never wait for an echo that may never
   * be recognised.
   */
  unconfirmed() {
    this.#state = GateState.AWAITING_ATTRIBUTION;
    if (this.#queued) this.#open("reply");
  }

  /**
   * The matching NEW user echo rendered.
   *
   * @returns {boolean} true when this call opened the gate.
   */
  echo() {
    if (this.#state !== GateState.AWAITING_ATTRIBUTION) return false;
    this.#open("echo");
    return true;
  }

  /**
   * A reply (move / no-move / resignation) from the watcher.
   *
   * @param {object} event
   * @returns {'delivered'|'queued'|'dropped'}
   */
  offer(event) {
    switch (this.#state) {
      case GateState.READY:
        this.deliver(event);
        return "delivered";
      case GateState.AWAITING_ATTRIBUTION:
        this.#queued = event;
        this.#open("reply");
        return "delivered";
      case GateState.VERIFYING:
        this.#queued = event; // newest reply wins; delivered after the verdict
        return "queued";
      default:
        return "dropped";
    }
  }

  /** Failure, cancel or pause: nothing from this request is ever delivered. */
  reset() {
    this.#state = GateState.IDLE;
    this.#queued = null;
    this.#attribution = "";
  }

  #open(attribution) {
    this.#state = GateState.READY;
    this.#attribution = attribution;
    try {
      this.onAttributed(attribution);
    } finally {
      this.#flush();
    }
  }

  #flush() {
    if (!this.#queued) return;
    const reply = this.#queued;
    this.#queued = null;
    this.deliver(reply);
  }
}
