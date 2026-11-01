// Dev page (/motion-text3d-lab.html, not linked from the app): try 3D text interactively. Every control
// change builds a MotionDoc in memory and loads it into a <MotionPlayer>; readouts show what the text
// costs (engine/docs/07-text3d.md, "Experiments"). window.__text3dLab exposes the hooks the e2e drives.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionPlayer, type MotionHandle } from '../src/react/MotionPlayer';
import type { MotionDocInput } from '../src/schema';
import { getText3DStats } from '../src/three/text/debug';

const OBJECT_ID = 'title';
const DURATION = 6;
const ENTER_PRESETS = ['none', 'glyphPop', 'glyphRise', 'glyphFlip', 'glyphFade'] as const;
const LOOP_PRESETS = ['none', 'glyphWave'] as const;
const EXIT_PRESETS = ['none', 'glyphFadeOut'] as const;
const LIGHTING = ['studio', 'window', 'golden', 'night', 'disco', 'none'] as const;
const FONTS = { bold: '/fonts/helvetiker_bold.typeface.json', regular: '/fonts/helvetiker_regular.typeface.json' } as const;
const DETERMINISM_PRESETS = ['glyphPop', 'glyphRise', 'glyphFlip', 'glyphWave'] as const;

interface Settings {
  text: string;
  font: keyof typeof FONTS;
  size: number;
  depth: number;
  bevel: boolean;
  curveSegments: number;
  align: 'left' | 'center' | 'right';
  enter: string;
  loop: string;
  exit: string;
  stagger: number;
  lighting: (typeof LIGHTING)[number];
  shadow: boolean;
}

const DEFAULTS: Settings = {
  text: 'Fresh every\nmorning',
  font: 'bold',
  size: 0.7,
  depth: 0.25,
  bevel: true,
  curveSegments: 8,
  align: 'center',
  enter: 'glyphPop',
  loop: 'glyphWave',
  exit: 'none',
  stagger: 0.05,
  lighting: 'studio',
  shadow: true,
};

function buildDoc(s: Settings): MotionDocInput {
  const preset = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    target: `glyphs:${OBJECT_ID}`,
    ...extra,
  });
  const staggerParams = { params: { stagger: s.stagger } };
  const layer: Record<string, unknown> = {
    id: 'stage',
    type: 'three',
    x: 960,
    y: 540,
    width: 1800,
    height: 1000,
    background: '#0b0f14',
    lighting: { preset: s.lighting },
    shadow: { enabled: s.shadow },
    camera: { position: [0, 0, 8], lookAt: [0, 0, 0], fov: 32 },
    objects: [
      {
        id: OBJECT_ID,
        geometry: {
          type: 'text3d',
          font: 'face',
          text: s.text,
          size: s.size,
          depth: s.depth,
          curveSegments: s.curveSegments,
          align: s.align,
          ...(s.bevel ? { bevel: {} } : {}),
        },
        position: [0, 0, 0],
        material: { color: '#ffd27a', roughness: 0.3, metalness: 0.2 },
      },
    ],
    end: DURATION,
  };
  if (s.enter !== 'none') layer.enter = preset(s.enter, staggerParams);
  if (s.loop !== 'none') layer.loop = preset(s.loop, staggerParams);
  if (s.exit !== 'none') layer.exit = preset(s.exit, { duration: 1.2, ...staggerParams });
  return {
    version: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    duration: DURATION,
    background: '#0b0f14',
    assets: { face: { type: 'font', url: FONTS[s.font] } },
    layers: [layer],
  } as unknown as MotionDocInput;
}

/** SHA-256 (first 12 hex chars) of a 64x36 downscale of the canvas (engine/lab/motion-lab.tsx). */
async function hashCanvas(canvas: HTMLCanvasElement | null): Promise<string> {
  if (!canvas) return 'no canvas';
  const small = document.createElement('canvas');
  small.width = 64;
  small.height = 36;
  const ctx = small.getContext('2d');
  if (!ctx) return 'no 2d';
  ctx.drawImage(canvas, 0, 0, 64, 36);
  const digest = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, 64, 36).data);
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Readout {
  glyphCount: number;
  uniqueGeometries: number;
  triangles: number;
  buildMs: number;
}

const FIELD: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 };

function Text3DLab() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [doc, setDoc] = useState<MotionDocInput>(() => buildDoc(DEFAULTS));
  const [stats, setStats] = useState<Readout | null>(null);
  const [frameMs, setFrameMs] = useState<number | null>(null);
  const [hash, setHash] = useState('');
  const [determinism, setDeterminism] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const player = useRef<MotionHandle>(null);
  const deltas = useRef<number[]>([]);
  const lastTick = useRef(0);
  const settingsRef = useRef(s);
  settingsRef.current = s;

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => setS((prev) => ({ ...prev, [key]: value })), []);

  // Each change rebuilds the doc (debounced a little so typing is not one rebuild per key).
  useEffect(() => {
    const id = setTimeout(() => setDoc(buildDoc(s)), 150);
    return () => clearTimeout(id);
  }, [s]);

  // The runtime rebuilds asynchronously after a doc change (fonts load first), so wait for a fresh stats
  // object rather than trusting whenReady, which can resolve against the previous build.
  const lastStats = useRef<unknown>(undefined);
  const readStats = useCallback(async () => {
    const deadline = performance.now() + 5000;
    while (getText3DStats()[OBJECT_ID] === lastStats.current && performance.now() < deadline) await sleep(50);
    await player.current?.whenReady(10);
    const found = getText3DStats()[OBJECT_ID];
    lastStats.current = found;
    setStats(found ? { ...found } : null);
  }, []);

  // After every doc load, read the stats of the object that was just built.
  useEffect(() => {
    setErrors([]);
    deltas.current = [];
    void readStats();
  }, [doc, readStats]);

  // onTime fires once per animation frame while playing: average the last 60 gaps.
  const onTime = useCallback(() => {
    const now = performance.now();
    const gap = now - lastTick.current;
    lastTick.current = now;
    if (gap > 2000 || gap <= 0) return; // first tick after a pause
    const list = deltas.current;
    list.push(gap);
    if (list.length > 60) list.shift();
    if (list.length >= 5 && list.length % 5 === 0) setFrameMs(list.reduce((a, b) => a + b, 0) / list.length);
  }, []);

  const seekHash = useCallback(async (t: number) => {
    player.current?.seek(t);
    await player.current?.whenReady(10);
    const h = await hashCanvas(player.current?.getCanvas() ?? null);
    setHash(h);
    return h;
  }, []);

  const checkDeterminism = useCallback(async () => {
    const original = settingsRef.current;
    const results: Record<string, string> = {};
    setDeterminism({});
    for (const name of DETERMINISM_PRESETS) {
      const isLoop = name === 'glyphWave';
      const next: Settings = { ...original, enter: isLoop ? 'none' : name, loop: isLoop ? name : 'none', exit: 'none' };
      setDoc(buildDoc(next));
      await sleep(100);
      await player.current?.whenReady(10);
      await sleep(100);
      player.current?.pause();
      const at = DURATION * 0.4;
      const a = await seekHash(at);
      await seekHash(0);
      const b = await seekHash(at);
      results[name] = a === b ? `match (${a})` : `MISMATCH ${a} vs ${b}`;
      setDeterminism({ ...results });
    }
    setDoc(buildDoc(original));
    return results;
  }, [seekHash]);

  useEffect(() => {
    (window as unknown as { __text3dLab: unknown }).__text3dLab = {
      handle: player.current,
      checkDeterminism,
      stats: () => getText3DStats()[OBJECT_ID] ?? null,
      hash: () => hashCanvas(player.current?.getCanvas() ?? null),
    };
  }, [checkDeterminism, doc]);

  const row = useMemo(() => ({ display: 'flex', gap: 12, flexWrap: 'wrap' as const, marginBottom: 12 }), []);
  const select = <T extends string>(label: string, value: T, options: readonly T[], on: (v: T) => void) => (
    <label style={FIELD}>
      {label}
      <select aria-label={label} value={value} onChange={(e) => on(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
  const num = (label: string, value: number, on: (v: number) => void, step: number, min: number, max?: number) => (
    <label style={FIELD}>
      {label}
      <input aria-label={label} type="number" value={value} step={step} min={min} max={max} style={{ width: 80 }} onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) on(v);
      }} />
    </label>
  );

  return (
    <main style={{ padding: 16, color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh', fontFamily: 'monospace' }}>
      <h1>text3d lab</h1>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ lineHeight: 0 }}>
          <MotionPlayer
            ref={player}
            doc={doc}
            displayWidth={720}
            autoplay
            loop
            onTime={onTime}
            onDocErrors={(e) => setErrors(e.map((x) => `${x.path}: ${x.message}`))}
            onLayerError={(id, message) => setErrors((prev) => [...prev, `${id}: ${message}`])}
          />
        </div>
        <div style={{ minWidth: 360 }}>
          <label style={{ ...FIELD, marginBottom: 12 }}>
            Text
            <textarea aria-label="Text" value={s.text} rows={3} style={{ width: 340 }} onChange={(e) => update('text', e.target.value)} />
          </label>
          <div style={row}>
            {select('Font', s.font, ['bold', 'regular'] as const, (v) => update('font', v))}
            {select('Align', s.align, ['left', 'center', 'right'] as const, (v) => update('align', v))}
            {select('Lighting', s.lighting, LIGHTING, (v) => update('lighting', v))}
          </div>
          <div style={row}>
            {num('Size', s.size, (v) => update('size', Math.max(0.05, v)), 0.05, 0.05)}
            {num('Depth', s.depth, (v) => update('depth', Math.max(0, v)), 0.05, 0)}
            {num('Curve segments', s.curveSegments, (v) => update('curveSegments', Math.min(24, Math.max(2, Math.round(v)))), 1, 2, 24)}
            {num('Stagger each', s.stagger, (v) => update('stagger', Math.max(0, v)), 0.01, 0)}
          </div>
          <div style={row}>
            <label style={FIELD}>
              <span>
                <input aria-label="Bevel" type="checkbox" checked={s.bevel} onChange={(e) => update('bevel', e.target.checked)} /> Bevel
              </span>
            </label>
            <label style={FIELD}>
              <span>
                <input aria-label="Shadow" type="checkbox" checked={s.shadow} onChange={(e) => update('shadow', e.target.checked)} /> Shadow
              </span>
            </label>
          </div>
          <div style={row}>
            {select('Enter', s.enter, ENTER_PRESETS, (v) => update('enter', v))}
            {select('Loop', s.loop, LOOP_PRESETS, (v) => update('loop', v))}
            {select('Exit', s.exit, EXIT_PRESETS, (v) => update('exit', v))}
          </div>
          <dl data-testid="stats" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 16px', margin: '0 0 12px' }}>
            <dt>glyphCount</dt>
            <dd data-testid="glyphCount" style={{ margin: 0 }}>{stats ? stats.glyphCount : '…'}</dd>
            <dt>uniqueGeometries</dt>
            <dd data-testid="uniqueGeometries" style={{ margin: 0 }}>{stats ? stats.uniqueGeometries : '…'}</dd>
            <dt>triangles</dt>
            <dd data-testid="triangles" style={{ margin: 0 }}>{stats ? stats.triangles : '…'}</dd>
            <dt>build time (ms)</dt>
            <dd data-testid="buildMs" style={{ margin: 0 }}>{stats ? stats.buildMs.toFixed(2) : '…'}</dd>
            <dt>avg frame time (ms)</dt>
            <dd data-testid="frameMs" style={{ margin: 0 }}>{frameMs !== null ? frameMs.toFixed(2) : '…'}</dd>
            <dt>canvas hash</dt>
            <dd data-testid="hash" style={{ margin: 0 }}>{hash || '—'}</dd>
          </dl>
          <button type="button" onClick={() => void checkDeterminism()}>
            Check determinism
          </button>
          <ul data-testid="determinism" style={{ paddingLeft: 16 }}>
            {DETERMINISM_PRESETS.filter((n) => determinism[n]).map((n) => (
              <li key={n} data-testid={`determinism-${n}`}>
                {n}: {determinism[n]}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {errors.length > 0 && <p data-testid="errors">{errors.join('; ')}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Text3DLab />);
