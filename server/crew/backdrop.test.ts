import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import type { Comp, Obj } from '../authoring/types';
import { coverScale, fillBackdrops } from './backdrop';

const PLATE = 'ast_' + 'a'.repeat(32);
const bg = (c: Comp): Obj => ((c.precomps as Record<string, Obj>).s1!.layers as Obj[]).find((l) => l.id === 's1:bg')!;

/** A tall film with a 720 x 1280 plate as the backdrop, the way the crew draws it, then given `scale` and `position` by a later pass. */
function film(scale: unknown, position: unknown = [540, 960]): Comp {
  let c = registerAsset(newFilmComposition({ aspect: '9:16', title: 'T', palette: ['#fff6e8'] }), { id: PLATE, kind: 'image', src: '/plate.jpg', width: 720, height: 1280 });
  c = addScene(c, { id: 's1', durationSec: 2, mode: 'motion', intent: 'dolly' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'image', assetId: PLATE });
  const out = structuredClone(c);
  const l = bg(out);
  l.transform = { ...(l.transform as Obj), anchor: [360, 640], position, scale };
  return out;
}

describe('fillBackdrops', () => {
  it('scales a plate left at scale 1 up to cover the frame, keeping its zoom', () => {
    // the dolly shot of film_16f2214a45dd: a fix pass set 1 -> 1.18 and the plate showed as a small rectangle
    const c = film([{ t: 0, v: [1, 1] }, { t: 42, v: [1.18, 1.18] }, { t: 60, v: [1.18, 1.18] }], [{ t: 0, v: [543.6, 960] }, { t: 60, v: [536.4, 960] }]);
    const { comp, fixed } = fillBackdrops(c, 's1');
    expect(fixed).toEqual(['s1:bg']);
    const keys = (bg(comp).transform as Obj).scale as Array<{ t: number; v: [number, number] }>;
    // covers at its widest drift (3.6 px off centre), and still zooms by the same 18 %
    expect(keys[0]!.v[0]).toBeGreaterThanOrEqual(1.5);
    expect(keys[1]!.v[0] / keys[0]!.v[0]).toBeCloseTo(1.18, 3);
    expect(keys.map((k) => k.t)).toEqual([0, 42, 60]);
  });

  it('leaves a backdrop that already covers the frame alone', () => {
    const c = film([{ t: 0, v: [1.8, 1.8] }, { t: 60, v: [1.836, 1.836] }]);
    expect(fillBackdrops(c, 's1')).toEqual({ comp: c, fixed: [] });
  });

  it('works for a still scale too, and an unknown scene is a no-op', () => {
    const c = film([1, 1]);
    const { comp } = fillBackdrops(c, 's1');
    expect(((bg(comp).transform as Obj).scale as number[])[0]).toBeCloseTo(1.5 * 1.01, 3);
    expect(fillBackdrops(c, 'nope')).toEqual({ comp: c, fixed: [] });
  });

  it('needs more scale the further the plate is moved off centre', () => {
    const centred = coverScale({ w: 720, h: 1280 }, [360, 640], [540, 960], 1080, 1920);
    const moved = coverScale({ w: 720, h: 1280 }, [360, 640], [600, 960], 1080, 1920);
    expect(centred).toBeCloseTo(1.515, 3);
    expect(moved).toBeGreaterThan(centred);
  });
});
