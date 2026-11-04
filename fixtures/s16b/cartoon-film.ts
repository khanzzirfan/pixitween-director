// A four-shot toy cartoon built the way the S16b blocking worker will write it: per shot one stage3d world plus actor3d/prop3d members, Pixi text on top, shots joined as precomps.
// Characters are the engine's generated fixtures until the forge (S16a) can make real ones.
const W = 1280;
const H = 720;
const SHOT = 120;
const FADE = 10;
const T = { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 };
const FULL = { position: [W / 2, H / 2], anchor: [W / 2, H / 2], scale: [1, 1], rotation: 0, opacity: 1 };
const ASSETS = {
  'toy-character': { type: 'model', src: '/cartoon/toy-character.glb' },
  'clip-walk': { type: 'model', src: '/cartoon/clip-walk.glb' },
  'clip-jump': { type: 'model', src: '/cartoon/clip-jump.glb' },
  'prop-crate': { type: 'model', src: '/cartoon/prop-crate.glb' },
  backdrop: { type: 'image', src: '/cartoon/backdrop.png', width: 1024, height: 512 },
};

type Json = Record<string, unknown>;

const world = (camera: Json, extra: Json = {}): Json => ({
  id: 'world', name: 'World', kind: 'stage3d', inPoint: 0, outPoint: SHOT, transform: FULL, viewport: { width: W, height: H },
  camera, set: { backdrop: 'backdrop' }, lights: { preset: 'studio' }, style: { shading: 'toon', toonSteps: 3, outline: { width: 0.012 } }, ...extra,
});
const actor = (id: string, o: Json): Json => ({ id, name: id, kind: 'actor3d', stage: 'world', inPoint: 0, outPoint: SHOT, assetId: 'toy-character', ...o });
const prop = (id: string, o: Json): Json => ({ id, name: id, kind: 'prop3d', stage: 'world', inPoint: 0, outPoint: SHOT, ...o });
const text = (id: string, source: string, y: number, size: number, o: Json = {}): Json => ({
  id, name: id, kind: 'text', inPoint: 0, outPoint: SHOT, transform: { ...T, position: [W / 2, y] }, source,
  style: { font: 'Inter, system-ui, sans-serif', size, fill: '#1b1b1b', weight: 700, align: 'center' }, ...o,
});
/** A black card that fades out over the first FADE frames (a fade-in from black) and in over the last (a fade-out). */
const dip = (): Json => ({
  id: 'dip', name: 'dip', kind: 'shape', inPoint: 0, outPoint: SHOT, path: { kind: 'rect', size: [W, H] }, fill: '#1b1b1b',
  transform: { ...FULL, opacity: [{ t: 0, v: 1 }, { t: FADE, v: 0 }, { t: SHOT - FADE, v: 0 }, { t: SHOT, v: 1 }] },
});

const shots: Json[][] = [
  // 1: establishing, hero waves
  [
    world({ position: [0, 1.2, 5], target: [0, 0.8, 0], fov: 35 }),
    actor('hero', { marks: [-0.3, 0, 20], clips: [{ name: 'Idle', startFrame: 0, loop: true }, { name: 'Wave', startFrame: 30, fadeFrames: 6 }, { name: 'Idle', startFrame: 80, loop: true }] }),
    prop('crate-l', { source: { type: 'gltf', assetId: 'prop-crate' }, size: 0.3, position: [-1.5, 0, 0.3] }),
    text('headline', 'Pip & the Cold Brew', 60, 64),
    dip(),
  ],
  // 2: a friend walks in, camera held (locked camera, motion from the actors)
  [
    world({ position: [0, 1.2, 5.5], target: [0, 0.8, 0], fov: 35 }),
    actor('hero', { marks: [-0.9, 0, 60], clips: [{ name: 'Idle', startFrame: 0, loop: true }] }),
    actor('pal', { inPoint: 10, height: 0.8, marks: [{ t: 10, v: [2.4, 0, -90] }, { t: 70, v: [0.6, 0, -90] }], clips: [{ clipAssetId: 'clip-walk', name: 'Walk', startFrame: 10, loop: true }, { name: 'Idle', startFrame: 70, loop: true }] }),
    prop('crate-r', { source: { type: 'gltf', assetId: 'prop-crate' }, size: 0.3, position: [1.6, 0, -0.4] }),
    text('caption', 'A friend drops by…', 650, 44),
    dip(),
  ],
  // 3: the product in hand, hero jumps for joy
  [
    world({ position: [0, 1.0, 4], target: [0, 0.8, 0], fov: 35 }, { lights: { preset: 'studio', key: { elevation: 40 } } }),
    actor('hero', { marks: [0, 0, 0], clips: [{ name: 'Idle', startFrame: 0, loop: true }, { name: 'Wave', startFrame: 15, fadeFrames: 6 }, { clipAssetId: 'clip-jump', name: 'Jump', startFrame: 70, fadeFrames: 4 }] }),
    prop('held-can', { role: 'product', source: { type: 'primitive', shape: 'can' }, size: 0.18, position: [0, 0.03, 0], attach: { actor: 'hero', bone: 'RightHand' } }),
    text('headline', 'Fresh. Cold. Brewed.', 70, 60),
    dip(),
  ],
  // 4: end card with the price
  [
    world({ position: [0, 1.2, 5], target: [0, 0.8, 0], fov: 35 }),
    actor('hero', { marks: [-0.8, 0, 45], clips: [{ name: 'Idle', startFrame: 0, loop: true }, { name: 'Wave', startFrame: 20, fadeFrames: 6 }] }),
    actor('pal', { height: 0.8, marks: [0.8, 0, -45], clips: [{ name: 'Idle', startFrame: 0, loop: true }] }),
    prop('can', { role: 'product', source: { type: 'primitive', shape: 'can' }, size: 0.35, position: [0, 0, 0.6], rotation: [{ t: 0, v: [0, 0, 0] }, { t: SHOT, v: [0, 360, 0] }] }),
    text('headline', 'Coffee Co. Cold Brew', 60, 60),
    text('price', '$24', 640, 72),
    dip(),
  ],
];

const bg = (): Json => ({ id: 'bg', name: 'Background', kind: 'shape', inPoint: 0, outPoint: SHOT, path: { kind: 'rect', size: [W, H] }, fill: '#f4ead5', transform: FULL });

export function buildCartoonFilm(): Json {
  const precomps: Record<string, Json> = {};
  const layers: Json[] = [];
  shots.forEach((members, i) => {
    const id = `s${i + 1}`;
    precomps[id] = { version: '1.11.0', id, name: id, width: W, height: H, fps: 30, durationInFrames: SHOT, bgColor: '#f4ead5', assets: ASSETS, layers: [bg(), ...members] };
    layers.push({ kind: 'precomp', id, name: id, inPoint: i * SHOT, outPoint: (i + 1) * SHOT, compId: id, width: W, height: H, transform: T });
  });
  return { version: '1.11.0', id: 'film', name: 'Pip & the Cold Brew', width: W, height: H, fps: 30, durationInFrames: SHOT * shots.length, bgColor: '#f4ead5', assets: ASSETS, layers, precomps };
}
