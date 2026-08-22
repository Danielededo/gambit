// Sound synthesis tests: every effect must render audible, well-formed audio.
// sound.js is browser code, but its synthesis functions are pure; the
// browser-only parts no-op safely under Node.

import { createReporter } from "./helpers.mjs";
import { RECIPES, renderSamples, encodeWav } from "../client/js/sound.js";

const { check, finish } = createReporter("sound");

for (const [name, notes] of Object.entries(RECIPES)) {
  const samples = renderSamples(notes);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  check(`${name}: audible peak (${peak.toFixed(2)})`, peak > 0.2 && peak <= 1.5);
  check(`${name}: non-trivial length (${samples.length} samples)`, samples.length > 500);

  const wav = encodeWav(samples);
  const bytes = new Uint8Array(await wav.arrayBuffer());
  const ascii = (start, len) => String.fromCharCode(...bytes.slice(start, start + len));
  check(`${name}: valid WAV header`, ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE");
  check(`${name}: data size matches`, bytes.length === 44 + samples.length * 2);
}

process.exit(finish() ? 0 : 1);
