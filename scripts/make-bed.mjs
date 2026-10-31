// Writes a 16 s, 120 bpm music bed (warm pad + soft kick + hat) as a mono 16-bit WAV. Synthesised here, so it is ours: no licence.
// Cuts at 4 s intervals land on bar lines (8 beats). Usage: node scripts/make-bed.mjs [out.wav]
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'web/public/cartoon/bed.wav';
const SR = 22050, SECS = 16, BPM = 120, beat = 60 / BPM;
const n = SR * SECS;
const f = new Float32Array(n);
const chords = [[220, 277.18, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 207.65, 246.94]]; // Am F G E-ish, one per 4 s
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
for (let i = 0; i < n; i++) {
  const t = i / SR;
  const ch = chords[Math.floor(t / 4) % 4];
  const env = Math.min(1, (t % 4) / 0.6) * Math.min(1, (4 - (t % 4)) / 0.5);
  let v = 0;
  for (const hz of ch) v += Math.sin(2 * Math.PI * hz * t) * 0.07 + Math.sin(2 * Math.PI * hz * 2.003 * t) * 0.025;
  v *= env;
  const bt = t % beat;
  v += Math.sin(2 * Math.PI * (52 + 70 * Math.exp(-bt * 30)) * bt) * Math.exp(-bt * 9) * 0.5 * (t >= 2 ? 1 : 0.0); // kick from 2 s
  const off = (t + beat / 2) % beat;
  v += rnd() * Math.exp(-off * 60) * 0.06 * (t >= 2 ? 1 : 0);
  f[i] = v;
}
const fade = SR * 0.8;
for (let i = 0; i < fade; i++) f[n - 1 - i] *= i / fade;
const buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, f[i])) * 32000, 44 + i * 2);
writeFileSync(out, buf);
console.log(`wrote ${out} (${(buf.length / 1e6).toFixed(2)} MB)`);
