// Game sounds. Effects are synthesized once into small in-memory WAV blobs
// and played through plain <audio> elements — standard media playback, which
// iOS does not mute with the ring/silent switch and which survives Safari's
// WebAudio quirks. All elements are unlocked with the classic play+pause
// inside the first user gesture. No audio files shipped, nothing to license.

const STORAGE_KEY = "gambit-sound";
const SAMPLE_RATE = 22050;

let enabled = true;
try {
  enabled = localStorage.getItem(STORAGE_KEY) !== "off";
} catch {
  // localStorage unavailable: default to on.
}

// --- Synthesis (same recipes as before, rendered offline) ---

// Each effect is a list of decaying notes: {freq, type, at, duration, gain}.
const RECIPES = {
  move: [{ freq: 520, type: "triangle", at: 0, duration: 0.07, gain: 0.5 }],
  capture: [
    { freq: 300, type: "triangle", at: 0, duration: 0.1, gain: 0.55 },
    { freq: 180, type: "sine", at: 0.01, duration: 0.14, gain: 0.4 },
  ],
  check: [
    { freq: 660, type: "sine", at: 0, duration: 0.09, gain: 0.4 },
    { freq: 880, type: "sine", at: 0.1, duration: 0.14, gain: 0.4 },
  ],
  end: [
    { freq: 523, type: "sine", at: 0, duration: 0.3, gain: 0.35 }, // C5
    { freq: 659, type: "sine", at: 0.02, duration: 0.3, gain: 0.28 }, // E5
    { freq: 784, type: "sine", at: 0.04, duration: 0.35, gain: 0.28 }, // G5
  ],
  notify: [
    { freq: 987, type: "sine", at: 0, duration: 0.12, gain: 0.35 }, // B5
    { freq: 1318, type: "sine", at: 0.09, duration: 0.2, gain: 0.35 }, // E6
  ],
};

// Exported for tests (pure functions, no DOM/audio dependencies).
export { RECIPES, renderSamples, encodeWav };

function waveform(type, phase) {
  const s = Math.sin(2 * Math.PI * phase);
  return type === "triangle" ? (2 / Math.PI) * Math.asin(s) : s;
}

function renderSamples(notes) {
  const total = Math.max(...notes.map((n) => n.at + n.duration)) + 0.05;
  const samples = new Float32Array(Math.ceil(total * SAMPLE_RATE));
  for (const note of notes) {
    const start = Math.floor(note.at * SAMPLE_RATE);
    const count = Math.floor(note.duration * SAMPLE_RATE);
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const t = i / SAMPLE_RATE;
      // Matches WebAudio's exponentialRamp from gain down to ~0.0001.
      const envelope = note.gain * Math.exp((-9.2 * t) / note.duration);
      samples[start + i] += waveform(note.type, note.freq * t) * envelope;
    }
  }
  return samples;
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// --- Playback ---

/** @type {Record<string, HTMLAudioElement>} */
const players = {};
let unlocked = false;

function buildPlayers() {
  if (Object.keys(players).length) return;
  try {
    for (const [name, notes] of Object.entries(RECIPES)) {
      const el = new Audio(URL.createObjectURL(encodeWav(renderSamples(notes))));
      el.preload = "auto";
      el.setAttribute("playsinline", "");
      players[name] = el;
    }
  } catch {
    // Audio unavailable: the game simply stays silent.
  }
}

buildPlayers();

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

  /**
   * Unlock every player inside a real user gesture (iOS requires each media
   * element to have started once during a gesture before it may be played
   * programmatically). Safe to call repeatedly; no-op once done.
   */
  unlock() {
    if (unlocked) return;
    unlocked = true; // optimistic; a rejected play flips it back for a retry
    for (const el of Object.values(players)) {
      try {
        const attempt = el.play();
        if (attempt && attempt.then) {
          attempt
            .then(() => {
              el.pause();
              el.currentTime = 0;
            })
            .catch(() => {
              unlocked = false;
            });
        }
      } catch {
        unlocked = false;
      }
    }
  },

  /** @param {"move"|"capture"|"check"|"end"|"notify"} name */
  play(name) {
    if (!enabled) return;
    const el = players[name];
    if (!el) return;
    try {
      el.currentTime = 0;
      const attempt = el.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
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
