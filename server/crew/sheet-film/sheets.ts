import { FILL, FOV_BASE, PRODUCT_H, PRODUCT_Y, framingDistance } from '../../authoring/cinematic-film';
import type { Comp, Obj } from '../../authoring/types';

// The part sheets of a 3D film: small compositions made from the built film's own JSON, one frame per panel, drawn by our own engine
// (renderKeyFrames) so a sheet shows exactly what the film will show. Pure: no I/O.

const SCENE = 'cine';
const WORLD = 'sheet:world';
const NEUTRAL = '#7d7d80';
const SIDE = 1080;
/** the most element panels on a sheet */
export const ELEMENTS_MAX = 6;
/** how much of the frame's height the thing on a sheet fills */
const SHEET_FILL = 0.6;
const YAWS = [0, 45, 90, 180] as const;

type V3 = [number, number, number];

/** The scene's layers: the inner composition of a built film, or the film itself when it has none. */
const inner = (film: Comp): Obj => ((film as Obj).precomps?.[SCENE] as Obj | undefined) ?? (film as Obj);
const layersOf = (film: Comp): Obj[] => (inner(film).layers as Obj[]) ?? [];
const stageOf = (film: Comp): Obj | undefined => layersOf(film).find((l) => l.id === `${SCENE}:world`);
const productOf = (film: Comp): Obj | undefined => layersOf(film).find((l) => l.kind === 'prop3d' && l.role === 'product' && l.stage === `${SCENE}:world`);
const kindOf = (l: Obj): string => /^cine:ing\d+-(.+)$/.exec(String(l.id))?.[1] ?? String(l.id);
/** One prop per element (the first shot that plays it): an element used in two shots is one panel. */
const elementsOf = (film: Comp): Obj[] =>
  layersOf(film)
    .filter((l) => l.kind === 'prop3d' && l.stage === `${SCENE}:world` && /^cine:ing\d+-/.test(String(l.id)))
    .filter((l, i, all) => all.findIndex((m) => kindOf(m) === kindOf(l)) === i)
    .slice(0, ELEMENTS_MAX);

/** A keyframe list ({ t, v } entries) becomes its first value, everywhere in `x`: a 2-frame sheet cannot carry the film's animation, and the engine refuses tweens that run past the layer. */
function still(x: unknown): unknown {
  if (Array.isArray(x)) {
    const first = x[0] as Obj | undefined;
    if (x.length && first && typeof first === 'object' && 't' in first && 'v' in first) return still(first.v);
    return x.map(still);
  }
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Obj).map(([k, v]) => [k, still(v)]));
  return x;
}

const hold = <T>(t: number, v: T) => ({ t, v, hold: true as const });
const lastValue = (v: unknown): V3 | undefined => (Array.isArray(v) && typeof v[0] === 'number' ? (v as V3) : Array.isArray(v) && v.length ? ((v.at(-1) as Obj).v as V3) : undefined);

/** Every asset of the film that the given layers name. */
function assetsFor(film: Comp, layers: Obj[]): Obj {
  const text = JSON.stringify(layers);
  const all = (film as Obj).assets as Obj;
  return Object.fromEntries(Object.entries(all ?? {}).filter(([id]) => text.includes(`"${id}"`)));
}

function sheetComp(film: Comp, o: { name: string; width: number; height: number; fps: number; frames: number; layers: Obj[]; panels?: number[] }): Comp {
  const unit = (film as Obj).meta?.rotationUnit ?? 'deg';
  return { version: (film as Obj).version, id: 'sheet', name: o.name, width: o.width, height: o.height, fps: o.fps, durationInFrames: o.frames, assets: assetsFor(film, o.layers), layers: o.layers, meta: { rotationUnit: unit, ...(o.panels ? { panels: o.panels } : {}) } } as unknown as Comp;
}

/** The seconds at which a sheet's panels are drawn: its own (`meta.panels`), else one per frame. */
export const panelTimes = (comp: Comp): number[] => ((comp as Obj).meta?.panels as number[] | undefined) ?? Array.from({ length: comp.durationInFrames as number }, (_, i) => i / (comp.fps as number));

const field = (w: number, h: number, frames: number): Obj => ({ kind: 'shape', id: 'sheet:bg', name: 'bg', inPoint: 0, outPoint: frames, path: { kind: 'rect', size: [w, h] }, fill: NEUTRAL, transform: { position: [w / 2, h / 2], anchor: [w / 2, h / 2], scale: [1, 1], rotation: 0, opacity: 1 } });

/** The studio world of a sheet: neutral light, no set, no grade, exposure 1. */
function studioWorld(frames: number, camera: Obj): Obj {
  return {
    id: WORLD,
    name: 'World',
    kind: 'stage3d',
    inPoint: 0,
    outPoint: frames,
    transform: { position: [SIDE / 2, SIDE / 2], anchor: [SIDE / 2, SIDE / 2], scale: [1, 1], rotation: 0, opacity: 1 },
    viewport: { width: SIDE, height: SIDE },
    camera,
    set: { ground: 'none', wall: false },
    style: { shading: 'pbr', exposure: 1 },
    shadow: { opacity: 0.45, softness: 0.7 },
    lights: { preset: 'studio', key: { azimuth: -30, elevation: 55, color: '#ffffff' }, rim: { intensity: 0.6 } },
  };
}

/** A camera that looks at the centre of a thing `height` m tall from the front, framing it at SHEET_FILL; one pose every `step` frames. */
const frontCamera = (heights: number[], step = 1): Obj => {
  const poses = heights.map((h) => ({ target: [0, h / 2, 0] as V3, position: [0, h / 2, framingDistance(SHEET_FILL, FOV_BASE, h)] as V3 }));
  const one = poses.length === 1;
  return {
    position: one ? poses[0]!.position : poses.map((p, i) => hold(i * step, p.position)),
    target: one ? poses[0]!.target : poses.map((p, i) => hold(i * step, p.target)),
    fov: FOV_BASE,
  };
};

/** The product turned front, three-quarter, side and back under neutral light on a grey field; undefined when the film has no product. */
export function productSheetComp(film: Comp): Comp | undefined {
  const product = productOf(film);
  if (!product) return undefined;
  const frames = YAWS.length;
  const lift = lastValue(product.position)?.[1] ?? 0;
  const prop: Obj = {
    ...structuredClone(product),
    stage: WORLD,
    inPoint: 0,
    outPoint: frames,
    position: [0, lift, 0],
    rotation: YAWS.map((yaw, i) => hold(i, [0, yaw, 0] as V3)),
  };
  const world = studioWorld(frames, frontCamera([PRODUCT_H]));
  return sheetComp(film, { name: 'product sheet', width: SIDE, height: SIDE, fps: 1, frames, layers: [field(SIDE, SIDE, frames), world, prop] });
}

/**
 * Each element of the film alone, centred on the neutral studio world; undefined when the film has no elements. Each element lives two frames
 * at 2 fps and is drawn between them: a liquid or vapour is timed by its prop's life, so drawn at its first instant a splash is a flat disc.
 */
export function elementSheetComp(film: Comp): Comp | undefined {
  const els = elementsOf(film);
  if (!els.length) return undefined;
  const frames = els.length * 2;
  const heights = els.map((e) => Math.max(typeof e.size === 'number' ? e.size : PRODUCT_H / 4, 0.02));
  // one piece, not the swarm: a swarm's pieces start high and fall or grow over time, so a still frame of it is empty
  const props = els.map((e, i): Obj => {
    const { position: _position, rotation: _rotation, scale: _scale, swarm: _swarm, ...rest } = structuredClone(e);
    return { ...rest, stage: WORLD, inPoint: i * 2, outPoint: i * 2 + 2, position: [0, 0, 0], rotation: [0, 20, 0] };
  });
  const world = studioWorld(frames, frontCamera(heights, 2));
  return sheetComp(film, { name: 'element sheet', width: SIDE, height: SIDE, fps: 2, frames, layers: [field(SIDE, SIDE, frames), world, ...props], panels: els.map((_, i) => i + 0.5) });
}

/** The empty set under the film's own light and grade, no prop in it: frame 0 a wide view from the front, frame 1 from the reverse. */
export function setSheetComp(film: Comp): Comp {
  const src = stageOf(film);
  if (!src) throw new Error('the film has no stage3d world');
  const meta = ((film as Obj).meta?.director?.layers ?? {}) as Record<string, { z?: number } | undefined>;
  const d = framingDistance(FILL.wide, FOV_BASE);
  const target: V3 = [0, PRODUCT_Y, 0];
  const frames = 2;
  const { shotTransitions: _t, timeWarp: _w, ...world } = still(structuredClone(src)) as Obj;
  const sheetWorld: Obj = {
    ...world,
    id: WORLD,
    outPoint: frames,
    camera: { position: [hold(0, [0, PRODUCT_Y, d] as V3), hold(1, [0, PRODUCT_Y, -d] as V3)], target, fov: FOV_BASE },
  };
  // the 2D field and halo under the world stay: they are part of how the set looks
  const under = layersOf(film).filter((l) => l.kind === 'shape' && (meta[String(l.id)]?.z ?? 0) >= 5).map((l) => ({ ...(still(structuredClone(l)) as Obj), outPoint: frames }));
  // so does the air that plays the whole film (bokeh, dust, smoke); a spray is a burst in one shot, not the set
  const air = layersOf(film)
    .filter((l) => l.kind === 'prop3d' && /^cine:air-/.test(String(l.id)) && !/-spray/.test(String(l.id)))
    .map((l) => ({ ...(still(structuredClone(l)) as Obj), stage: WORLD, inPoint: 0, outPoint: frames }));
  const s = src.viewport as { width: number; height: number };
  return sheetComp(film, { name: 'set sheet', width: s.width, height: s.height, fps: 1, frames, layers: [...under, sheetWorld, ...air] });
}

/** The labels of the panels, in order. */
export function sheetLabels(film: Comp): { product: string[]; elements: string[]; set: string[] } {
  return {
    product: ['front', '3/4', 'side', 'back'],
    elements: elementsOf(film).map((e) => {
      const id = kindOf(e);
      const action = typeof e.name === 'string' ? e.name.replace(`${id} `, '').trim() : '';
      return action && action !== e.name ? `${id}: ${action}` : id;
    }),
    set: ['wide', 'reverse'],
  };
}
