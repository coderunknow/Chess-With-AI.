/**
 * Short WebAudio wood knocks: filtered noise (the tap) plus a damped low
 * resonant body. No samples, assets, oscillator beeps, or network activity.
 * Sounds are off by default; the caller supplies the persisted 0–1 volume.
 *
 * @module shared/sounds
 */

import { MoveFlag } from "../core/move.js";

let audioContext = null;

function getContext() {
  if (audioContext) return audioContext;
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
    return audioContext;
  } catch {
    return null;
  }
}

const CONFIG = Object.freeze({
  move: { pitch: 190, length: 0.095, force: 0.55, taps: [0] },
  capture: { pitch: 155, length: 0.14, force: 0.95, taps: [0, 0.045] },
  check: { pitch: 205, length: 0.17, force: 0.8, taps: [0, 0.09] },
  castle: { pitch: 170, length: 0.11, force: 0.65, taps: [0, 0.12] },
  promotion: { pitch: 230, length: 0.14, force: 0.7, taps: [0, 0.09, 0.18] },
  gameOver: { pitch: 135, length: 0.2, force: 0.7, taps: [0, 0.22] },
});

function knock(ctx, config, offset, volume) {
  const time = ctx.currentTime + offset;
  const count = Math.floor(ctx.sampleRate * config.length);
  const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < count; index += 1) {
    data[index] = (Math.random() * 2 - 1) * Math.exp((-14 * index) / count);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(950, time);
  filter.frequency.exponentialRampToValueAtTime(380, time + config.length);
  const tapGain = ctx.createGain();
  const level = Math.max(0.001, volume * config.force * 0.14);
  tapGain.gain.setValueAtTime(level, time);
  tapGain.gain.exponentialRampToValueAtTime(0.001, time + config.length);
  noise.connect(filter);
  filter.connect(tapGain);
  tapGain.connect(ctx.destination);
  noise.start(time);
  noise.stop(time + config.length);

  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.type = "sine";
  body.frequency.setValueAtTime(config.pitch, time);
  body.frequency.exponentialRampToValueAtTime(config.pitch * 0.78, time + config.length);
  bodyGain.gain.setValueAtTime(level * 0.38, time);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, time + config.length);
  body.connect(bodyGain);
  bodyGain.connect(ctx.destination);
  body.start(time);
  body.stop(time + config.length);
}

/** @param {'move'|'capture'|'check'|'castle'|'promotion'|'gameOver'} kind @param {number} volume */
export function playSound(kind, volume = 0.4) {
  const config = CONFIG[kind] || CONFIG.move;
  const level = Number.isFinite(Number(volume)) ? Math.max(0, Math.min(1, Number(volume))) : 0.4;
  if (level === 0) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {}); // invoked on a user gesture
    for (const offset of config.taps) knock(ctx, config, offset, level);
  } catch {
    // No sound device is not a chess error.
  }
}

/** Pure classification from the real move flags, never from UCI text. */
export function soundForMove(move, _positionBefore, positionAfter) {
  if (positionAfter.outcome().over) return "gameOver";
  if (positionAfter.isCheck()) return "check";
  if (move.flags & (MoveFlag.KING_CASTLE | MoveFlag.QUEEN_CASTLE)) return "castle";
  if (move.promotion) return "promotion";
  if (move.flags & (MoveFlag.CAPTURE | MoveFlag.EN_PASSANT)) return "capture";
  return "move";
}
