import type { Comp, Obj } from './types';

// Deterministic finishing pass for a built film (S17 polish): contact shadow under the product, a warm grade,
// ad-grade type and a music bed. Pure and idempotent: layers it adds carry the `finish:` id prefix and are replaced on a re-run.
const PREFIX = 'finish:';

export interface FinishOptions {
  /** Warm grade colour laid over every shot. */
  grade?: string;
  /** Registered audio asset id for the music bed; the layer is added only when given. */
  musicAssetId?: string;
  /** Bed level 0..1. */
  musicLevel?: number;
}

const isFinish = (l: Obj): boolean => typeof l.id === 'string' && l.id.startsWith(PREFIX);

const SHADOW = { name: 'drop-shadow', params: { distance: 26, direction: 180, softness: 30, opacity: 0.5, color: '#1a0f08' } };

/** Type that reads like an ad: heavier headline, tracked caption, the price punched up. */
function dressText(l: Obj): void {
  const s = l.style as Obj | undefined;
  if (!s) return;
  const price = typeof l.source === 'string' && /^[$€£]\s?\d/.test(l.source);
  if (price) {
    s.weight = 800;
    s.size = Math.max(s.size ?? 0, 168);
    s.font = 'Georgia, "Times New Roman", serif';
  } else if (l.id.endsWith(':caption')) {
    s.weight = 600;
    s.size = Math.max(s.size ?? 0, 52);
    s.letterSpacing = 6;
  } else {
    s.weight = Math.max(Number(s.weight ?? 0), 700);
  }
  l.effects = [{ name: 'drop-shadow', params: { distance: 4, direction: 180, softness: 8, opacity: 0.35, color: '#000000' } }];
}

function gradeLayer(sceneId: string, w: number, h: number, frames: number, colour: string): Obj {
  return {
    kind: 'shape',
    id: `${PREFIX}${sceneId}:grade`,
    name: 'grade',
    inPoint: 0,
    outPoint: frames,
    path: { kind: 'rect', size: [w, h] },
    fill: colour,
    blendMode: 'soft-light',
    transform: { position: [w / 2, h / 2], anchor: [w / 2, h / 2], scale: [1, 1], rotation: 0, opacity: 0.16 },
  };
}

/** A white flash on the first frames of a shot, so each cut lands like a beat. */
function flashLayer(sceneId: string, w: number, h: number, frames: number): Obj {
  return {
    kind: 'shape',
    id: `${PREFIX}${sceneId}:flash`,
    name: 'flash',
    inPoint: 0,
    outPoint: frames,
    path: { kind: 'rect', size: [w, h] },
    fill: '#fff3de',
    blendMode: 'screen',
    transform: {
      position: [w / 2, h / 2],
      anchor: [w / 2, h / 2],
      scale: [1, 1],
      rotation: 0,
      opacity: [
        { t: 0, v: 0.35, easeOut: [0, 0, 0.58, 1] },
        { t: 8, v: 0 },
      ],
    },
  };
}

export function finishComposition(c: Comp, o: FinishOptions = {}): Comp {
  const out = structuredClone(c);
  const director = (out.meta?.director ?? {}) as Obj;
  const roles = (director.layers ?? {}) as Record<string, { role?: string }>;
  const colour = o.grade ?? '#ffb870';

  for (const [pid, p] of Object.entries((out.precomps ?? {}) as Record<string, Obj>)) {
    const layers: Obj[] = (p.layers as Obj[]).filter((l) => !isFinish(l));
    for (const l of layers) {
      if (l.kind === 'image' && roles[l.id]?.role === 'product') l.effects = [structuredClone(SHADOW)];
      if (l.kind === 'text') dressText(l);
    }
    // the grade and the flash sit under the type, over the photography
    const at = layers.findIndex((l) => l.kind === 'text');
    const extra = [gradeLayer(pid, p.width, p.height, p.durationInFrames, colour), flashLayer(pid, p.width, p.height, p.durationInFrames)];
    layers.splice(at < 0 ? layers.length : at, 0, ...extra);
    p.layers = layers;
  }

  const top = (out.layers as Obj[]).filter((l) => !isFinish(l));
  if (o.musicAssetId) {
    top.unshift({
      kind: 'audio',
      id: `${PREFIX}music`,
      name: 'music',
      inPoint: 0,
      outPoint: out.durationInFrames,
      assetId: o.musicAssetId,
      level: o.musicLevel ?? 0.7,
      transform: { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
    });
  }
  out.layers = top as Comp['layers'];
  return out;
}
