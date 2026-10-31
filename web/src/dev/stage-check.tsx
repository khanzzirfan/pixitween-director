// Dev page (/stage-check.html, not linked from the app): a four-shot stage3d toy cartoon, to prove the film loads, draws, seeks to the same picture twice, plays through its cuts and takes a text edit.
// Characters are the engine's fixture models (public/cartoon) until the forge can make real ones.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseAepCompositionSafe, type AepCompositionJson } from 'reacthub-pixitweenjs';
import { buildCartoonFilm } from '../../../fixtures/s16b/cartoon-film';
import Player, { type PlayerHandle } from '../player/Player';
import '../styles.css';

const SHOT_SEC = 4;

/** ?film=robot: one 8 s shot of the Quaternius robot (walk, jump, wave) among converted props, to check scale, colour and clips. */
function robotFilm(): AepCompositionJson {
  const f = buildCartoonFilm() as { assets: Record<string, unknown>; durationInFrames: number; layers: unknown[]; precomps: Record<string, { assets: Record<string, unknown>; layers: Array<Record<string, unknown>> }> };
  const assets = { ...f.assets, robot: { type: 'model', src: '/cartoon/characters/robot.glb' }, bed: { type: 'model', src: '/cartoon/props/q-bed-single.glb' }, can: { type: 'model', src: '/cartoon/props/q-sodacan.glb' }, plant: { type: 'model', src: '/cartoon/props/q-houseplant-1.glb' }, fridge: { type: 'model', src: '/cartoon/props/q-kitchen-2drawers.glb' } };
  const s1 = f.precomps.s1!;
  s1.assets = assets;
  const keep = s1.layers.filter((l) => l.kind === 'shape' || l.kind === 'stage3d');
  const prop = (id: string, assetId: string, size: number, position: number[]) => ({ id, name: id, kind: 'prop3d', stage: 'world', inPoint: 0, outPoint: 120, source: { type: 'gltf', assetId }, size, position });
  s1.layers = [
    ...keep,
    { id: 'hero', name: 'hero', kind: 'actor3d', stage: 'world', inPoint: 0, outPoint: 120, assetId: 'robot', height: 1, marks: [{ t: 0, v: [-1.2, 0, -90] }, { t: 15, v: [-1.2, 0, -90] }, { t: 60, v: [0.9, 0, -90] }, { t: 61, v: [0.9, 0, 0] }], clips: [{ name: 'Walk', startFrame: 0, loop: true }, { name: 'Idle', startFrame: 30, fadeFrames: 6, loop: true }, { name: 'Jump', startFrame: 62, fadeFrames: 4 }, { name: 'Wave', startFrame: 90, fadeFrames: 6 }] },
    prop('bed', 'bed', 0.9, [-1.8, 0, -0.8]),
    prop('can', 'can', 0.25, [1.5, 0, 0.3]),
    prop('plant', 'plant', 0.5, [1.9, 0, -0.6]),
    prop('fridge', 'fridge', 1.1, [2.4, 0, -1]),
  ];
  f.precomps = { s1 };
  f.assets = assets;
  f.durationInFrames = 120;
  f.layers = [f.layers[0]];
  return f as unknown as AepCompositionJson;
}

async function hashCanvas(canvas: HTMLCanvasElement | null, rect?: [number, number, number, number]): Promise<string> {
  if (!canvas) return 'no canvas';
  const small = document.createElement('canvas');
  small.width = 64;
  small.height = 36;
  const ctx = small.getContext('2d');
  if (!ctx) return 'no 2d';
  const [x, y, w, h] = rect ?? [0, 0, canvas.width, canvas.height];
  ctx.drawImage(canvas, x, y, w, h, 0, 0, 64, 36);
  const digest = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, 64, 36).data);
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))));

function StageCheck() {
  const player = useRef<PlayerHandle>(null);
  const [price, setPrice] = useState('$24');
  const [ready, setReady] = useState('waiting for the engine…');
  const [errors, setErrors] = useState<string[]>([]);
  const [report, setReport] = useState<string[]>([]);
  // ?film=live plays the film the s16-block live script wrote (public/cartoon/live-film.json) instead of the hand-made one
  const [live, setLive] = useState<AepCompositionJson | null>(null);
  const filmParam = new URLSearchParams(window.location.search).get('film');
  const wantsLive = filmParam === 'live' || filmParam === 'spike';
  useEffect(() => {
    if (wantsLive) void fetch(new URLSearchParams(window.location.search).get('file') ?? '/cartoon/live-film.json').then((r) => r.json()).then(setLive);
  }, [wantsLive, filmParam]);
  const wantsRobot = new URLSearchParams(window.location.search).get('film') === 'robot';
  const film = useMemo(() => {
    if (wantsRobot) return robotFilm();
    if (wantsLive) return live as AepCompositionJson;
    const f = buildCartoonFilm() as { precomps: Record<string, { layers: Array<{ id: string; source?: string }> }> };
    const p = f.precomps.s4?.layers.find((l) => l.id === 'price');
    if (p) p.source = price;    return f as unknown as AepCompositionJson;
  }, [price, wantsLive, wantsRobot, live]);
  const verdict = useMemo(() => parseAepCompositionSafe(film), [film]);
  const duration = film ? film.durationInFrames / film.fps : 0;

  const seek = async (sec: number) => {
    player.current?.seek(sec);
    await frame();
  };
  const hashAt = async (sec: number, rect?: [number, number, number, number]) => {
    await seek(sec);
    return hashCanvas(player.current?.getCanvas() ?? null, rect);
  };
  const runChecks = async () => {
    const out: string[] = [];
    const ok = await player.current?.whenReady(10);
    out.push(`ready: ${ok ? 'pass' : 'FAIL'}`);
    const a = await hashAt(SHOT_SEC * 2 + 2);
    await seek(1);
    const b = await hashAt(SHOT_SEC * 2 + 2);
    out.push(`seek same time twice: ${a === b ? 'pass' : 'FAIL'} (${a} / ${b})`);
    const shots = [];
    for (let i = 0; i < 4; i++) shots.push(await hashAt(i * SHOT_SEC + 2));
    out.push(`four shots differ: ${new Set(shots).size === 4 ? 'pass' : 'FAIL'} (${shots.join(' ')})`);
    setReport(out);
  };
  const play = async () => {
    player.current?.seek(0);
    player.current?.play();
  };

  if (!film) return <main style={{ padding: 16, color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh' }}>Loading the live film…</main>;
  return (
    <main style={{ padding: 12, color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh', fontSize: 13 }}>
      <h1 style={{ fontSize: 16, margin: '0 0 4px' }}>3D stage check — {film.name}</h1>
      <p data-testid="verdict" style={{ margin: '0 0 8px' }}>engine schema: {verdict.success ? 'ok' : `errors: ${JSON.stringify((verdict as { error?: unknown }).error).slice(0, 600)}`}</p>
      {/* compact: the stage is at most 60% of the window high, so the controls stay in view */}
      <div style={{ width: `min(100%, calc(60vh * ${film.width} / ${film.height}))` }}>
        <Player key={price} ref={player} composition={film} onError={(e) => console.error('player error', e)} onLayerError={(id, e) => setErrors((x) => [...x, `${id}: ${String(e)}`])} />
      </div>
      <p>
        {[0, 0.5, 1, 2, 3, 3.5, 6, 10, 14, 18, 22].map((t) => (
          <button key={t} type="button" onClick={() => void seek(t)} style={{ marginRight: 8 }}>
            Seek {t} s
          </button>
        ))}
        <button type="button" onClick={() => void play()} style={{ marginRight: 8 }}>Play from 0</button>
        <button type="button" onClick={() => void runChecks()} style={{ marginRight: 8 }}>Run checks</button>
        <button type="button" onClick={() => setPrice(price === '$24' ? '$19' : '$24')}>Edit price</button>
      </p>
      <p>Film is {duration} s, four shots. Price now {price}.</p>
      <p data-testid="ready">{ready}</p>
      <button type="button" onClick={() => void player.current?.whenReady(10).then((ok) => setReady(ok ? 'every 3D layer has drawn' : 'a 3D layer did not draw'))}>Wait for 3D</button>
      {errors.length > 0 && <p data-testid="errors">{errors.join('; ')}</p>}
      <pre data-testid="report">{report.join('\n')}</pre>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StageCheck />);
