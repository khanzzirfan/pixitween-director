// Dev page (/three-check.html, not linked from the app): the fixture can with its label, sway, golden light and shadow, so the look can be judged before a live run.
// Needs engine 0.3.0-alpha.4 or newer. It shows whether the engine said the 3D layer drew, and a hash of the canvas so two seeks to one time can be compared.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import raw from '../../../fixtures/s13b/three-check.json';
import Player, { type PlayerHandle } from '../player/Player';
import '../styles.css';

const comp = raw as unknown as AepCompositionJson;
const DURATION = comp.durationInFrames / comp.fps;

async function hashCanvas(canvas: HTMLCanvasElement | null): Promise<string> {
  if (!canvas) return 'no canvas';
  const small = document.createElement('canvas');
  small.width = 64;
  small.height = 36;
  const ctx = small.getContext('2d');
  if (!ctx) return 'no 2d';
  ctx.drawImage(canvas, 0, 0, 64, 36);
  const data = ctx.getImageData(0, 0, 64, 36).data;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function ThreeCheck() {
  const player = useRef<PlayerHandle>(null);
  const [ready, setReady] = useState<string>('waiting for the engine…');
  const [errors, setErrors] = useState<string[]>([]);
  const [time, setTime] = useState(0);
  const [hashes, setHashes] = useState<string[]>([]);

  const seek = async (sec: number) => {
    player.current?.seek(sec);
    setTime(sec);
    await frame();
  };
  const check = async () => {
    const ok = await player.current?.whenReady(10);
    setReady(ok ? 'every 3D layer has drawn' : 'a 3D layer did not draw in 10 s');
  };
  const twice = async () => {
    const at = DURATION / 2;
    await seek(at);
    const a = await hashCanvas(player.current?.getCanvas() ?? null);
    await seek(0);
    await seek(at);
    const b = await hashCanvas(player.current?.getCanvas() ?? null);
    setHashes([a, b, a === b ? 'same' : 'different']);
  };

  return (
    <main style={{ padding: 16, color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh' }}>
      <h1>3D product check</h1>
      <p>The can turns from -18 to 18 degrees over {DURATION} s. The headline sits behind it, so the middle of the turn hides it; the caption is in front. A shadow should fall on the plate.</p>
      <Player ref={player} composition={comp} onError={(e) => console.error('player error', e)} onLayerError={(id, e) => setErrors((x) => [...x, `${id}: ${String(e)}`])} />
      <p>
        {[0, DURATION / 2, DURATION - 0.1].map((t) => (
          <button key={t} type="button" onClick={() => void seek(t)} style={{ marginRight: 8 }}>
            Seek to {t.toFixed(1)} s
          </button>
        ))}
        <button type="button" onClick={() => void check()} style={{ marginRight: 8 }}>
          Wait for the 3D layer
        </button>
        <button type="button" onClick={() => void twice()}>
          Seek twice and compare
        </button>
      </p>
      <p data-testid="readout">At {time.toFixed(2)} s</p>
      <p data-testid="ready">{ready}</p>
      {errors.length > 0 && <p data-testid="errors">{errors.join('; ')}</p>}
      {hashes.length > 0 && <p data-testid="hashes">{hashes.join(' · ')}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ThreeCheck />);
