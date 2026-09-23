/**
 * Move/capture/check sounds generated with WebAudio — no asset files.
 *
 * Off by default, remembered in settings. Respects user preference.
 * Pure logic except for AudioContext usage, which is guarded.
 *
 * @module shared/sounds
 */

let audioContext = null;

/**
 * @returns {AudioContext|null}
 */
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

/**
 * Plays a short tone.
 *
 * @param {object} options
 * @param {number} options.frequency Hz
 * @param {number} [options.duration] ms, default 120
 * @param {number} [options.volume] 0-1, default 0.3
 * @param {'sine'|'square'|'triangle'|'sawtooth'} [options.type]
 */
function playTone({ frequency, duration = 120, volume = 0.3, type = "sine" }) {
  const ctx = getContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.value = volume;

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration / 1000);

    oscillator.start(now);
    oscillator.stop(now + duration / 1000);
  } catch {
    // Audio failed, ignore
  }
}

/**
 * Plays sound for a move type.
 *
 * @param {'move'|'capture'|'check'|'castle'|'promotion'|'gameOver'} kind
 */
export function playSound(kind) {
  switch (kind) {
    case "move":
      playTone({ frequency: 440, duration: 80, volume: 0.2, type: "sine" });
      break;
    case "capture":
      playTone({ frequency: 220, duration: 150, volume: 0.3, type: "square" });
      // Second tone for capture
      setTimeout(() => playTone({ frequency: 330, duration: 100, volume: 0.2, type: "sine" }), 50);
      break;
    case "check":
      playTone({ frequency: 660, duration: 200, volume: 0.3, type: "sawtooth" });
      setTimeout(() => playTone({ frequency: 880, duration: 200, volume: 0.3, type: "sawtooth" }), 150);
      break;
    case "castle":
      playTone({ frequency: 300, duration: 100, volume: 0.25, type: "triangle" });
      setTimeout(() => playTone({ frequency: 500, duration: 120, volume: 0.25, type: "triangle" }), 80);
      break;
    case "promotion":
      playTone({ frequency: 523, duration: 100, volume: 0.3, type: "sine" });
      setTimeout(() => playTone({ frequency: 659, duration: 100, volume: 0.3, type: "sine" }), 100);
      setTimeout(() => playTone({ frequency: 784, duration: 150, volume: 0.3, type: "sine" }), 200);
      break;
    case "gameOver":
      playTone({ frequency: 440, duration: 300, volume: 0.3, type: "sine" });
      setTimeout(() => playTone({ frequency: 330, duration: 300, volume: 0.3, type: "sine" }), 200);
      setTimeout(() => playTone({ frequency: 220, duration: 500, volume: 0.3, type: "sine" }), 400);
      break;
    default:
      playTone({ frequency: 440, duration: 80, volume: 0.2 });
  }
}

/**
 * Determines sound kind from a move.
 *
 * @param {import('../core/move.js').Move} move
 * @param {import('../core/position.js').Position} positionBefore
 * @param {import('../core/position.js').Position} positionAfter
 * @returns {'move'|'capture'|'check'|'castle'|'promotion'|'gameOver'}
 */
export function soundForMove(move, positionBefore, positionAfter) {
  if (positionAfter.outcome().over) {
    return "gameOver";
  }
  if (positionAfter.isCheck()) {
    return "check";
  }
  if (move.flags & 0b110000) {
    // castle flags
    return "castle";
  }
  if (move.promotion) {
    return "promotion";
  }
  if (move.flags & 1) {
    return "capture";
  }
  return "move";
}
