// Game sounds, synthesized with WebAudio — no audio files to ship or license.
// The AudioContext is created lazily on the first play, which always happens
// inside a user gesture (a click on the board), satisfying autoplay policies.

const STORAGE_KEY = "gambit-sound";

let ctx = null;
let enabled = true;

try {
  enabled = localStorage.getItem(STORAGE_KEY) !== "off";
} catch {
  // localStorage unavailable: default to on.
}

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** One decaying tone. */
function tone(ac, { freq, type = "sine", at = 0, duration = 0.08, gain = 0.12 }) {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  const t0 = ac.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

const EFFECTS = {
  // Dry wooden tap for a quiet move.
  move: (ac) => tone(ac, { freq: 520, type: "triangle", duration: 0.06, gain: 0.15 }),
  // Lower, slightly longer thud for a capture.
  capture: (ac) => {
    tone(ac, { freq: 300, type: "triangle", duration: 0.09, gain: 0.2 });
    tone(ac, { freq: 180, type: "sine", at: 0.01, duration: 0.12, gain: 0.12 });
  },
  // Rising two-note alert for check.
  check: (ac) => {
    tone(ac, { freq: 660, duration: 0.08, gain: 0.12 });
    tone(ac, { freq: 880, at: 0.09, duration: 0.12, gain: 0.12 });
  },
  // Small closing chord for checkmate/draw/resignation.
  end: (ac) => {
    tone(ac, { freq: 523, at: 0, duration: 0.28, gain: 0.1 }); // C5
    tone(ac, { freq: 659, at: 0.02, duration: 0.28, gain: 0.08 }); // E5
    tone(ac, { freq: 784, at: 0.04, duration: 0.32, gain: 0.08 }); // G5
  },
  // Distinct ding for events that need attention (opponent joined, chat…).
  notify: (ac) => {
    tone(ac, { freq: 987, duration: 0.1, gain: 0.1 }); // B5
    tone(ac, { freq: 1318, at: 0.08, duration: 0.18, gain: 0.1 }); // E6
  },
};

export const sound = {
  isEnabled() {
    return enabled;
  },

  setEnabled(value) {
    enabled = Boolean(value);
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch {
      // ignore
    }
  },

  /** @param {"move"|"capture"|"check"|"end"|"notify"} name */
  play(name) {
    if (!enabled || !EFFECTS[name]) return;
    try {
      const ac = context();
      if (ac) EFFECTS[name](ac);
    } catch {
      // Audio is a nicety: never let it break the game.
    }
  },

  /** Pick the right effect for a just-played move. */
  playForMove({ captured = false, inCheck = false, gameOver = false } = {}) {
    if (gameOver) this.play("end");
    else if (inCheck) this.play("check");
    else if (captured) this.play("capture");
    else this.play("move");
  },
};
