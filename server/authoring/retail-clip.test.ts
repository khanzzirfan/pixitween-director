import { describe, expect, it } from 'vitest';
import { buildRetailClip, pulseKeys, retailLayout, shade, type Rect, type RetailClipInput } from './retail-clip';
import type { Obj } from './types';

const input = (o: Partial<RetailClipInput> = {}): RetailClipInput => ({
  aspect: '9:16',
  plate: { id: 'ast_plate', src: '/p.png', width: 720, height: 1280 },
  product: { id: 'ast_prod', src: '/c.png', width: 256, height: 752 },
  title: 'Stone Mug 350ml',
  subtitle: '350 ml',
  price: 19,
  brand: 'Hearth',
  ...o,
});
const layers = (c: any): Obj[] => c.precomps.clip.layers;
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const ellipses = (c: any) => layers(c).filter((l) => l.kind === 'shape' && l.path.kind === 'ellipse');

describe('buildRetailClip', () => {
  it('builds one scene: plate, pack, price badge, slim description and brand', () => {
    const c = buildRetailClip(input()) as any;
    expect(c.durationInFrames).toBe(120);
    expect(layers(c).some((l) => l.kind === 'image' && l.assetId === 'ast_plate')).toBe(true);
    expect(layers(c).some((l) => l.id === 'clip:product')).toBe(true);
    const texts = layers(c).filter((l) => l.kind === 'text').map((l) => l.source);
    expect(texts).toEqual(expect.arrayContaining(['$19.00', 'Stone Mug 350ml', '350 ml', 'Hearth']));
  });

  it('is deterministic', () => {
    expect(buildRetailClip(input())).toEqual(buildRetailClip(input()));
  });

  it('the pack rests on a soft contact shadow, so it does not float', () => {
    const c = buildRetailClip(input()) as any;
    const sh = ellipses(c).find((l) => l.effects?.[0]?.name === 'gaussian-blur')!;
    expect(sh).toBeTruthy();
    expect(sh.transform.opacity).toBeGreaterThan(0.2);
    const order = layers(c).map((l) => l.id);
    expect(order.indexOf(sh.id)).toBeLessThan(order.indexOf('clip:product')); // drawn under the pack
  });

  it('the push-in is relative to the fitted size and keeps the base on the table', () => {
    const c = buildRetailClip(input()) as any;
    const pack = layers(c).find((l) => l.id === 'clip:product')!;
    const L = retailLayout(1080, 1920, input().product);
    const k = L.pack.w / 256;
    const scales = pack.transform.scale.map((f: any) => f.v[0]);
    expect(scales[1]).toBeCloseTo(k, 3);
    const bottoms = pack.transform.position.map((f: any, n: number) => f.v[1] + (scales[n] * 752) / 2);
    for (const b of bottoms) expect(b).toBeCloseTo(L.pack.y + L.pack.h, 0);
  });

  it('draws a brand frame behind the plate when asked', () => {
    const c = buildRetailClip(input({ frame: true, accent: '#005a2b' })) as any;
    const order = layers(c).map((l) => l.id);
    const frame = layers(c).find((l) => l.kind === 'shape' && l.fill === '#005a2b' && l.path.kind === 'rect' && l.path.size[0] === 1080)!;
    const plate = layers(c).find((l) => l.kind === 'image' && l.assetId === 'ast_plate')!;
    expect(order.indexOf(frame.id)).toBeLessThan(order.indexOf(plate.id));
  });

  it('omits the brand badge without a brand, the subtitle without one, and enforces a minimum length', () => {
    const c = buildRetailClip(input({ brand: undefined, subtitle: undefined, durationSec: 1 })) as any;
    const texts = layers(c).filter((l) => l.kind === 'text').map((l) => l.source);
    expect(texts).not.toContain('Hearth');
    expect(texts).not.toContain('350 ml');
    expect(c.durationInFrames).toBe(75);
  });

  it('formats the price with its currency', () => {
    const c = buildRetailClip(input({ price: 4.5, currency: 'EUR' })) as any;
    expect(layers(c).some((l) => l.source === '€4.50')).toBe(true);
  });

  it('animates the badge pieces together with a pop then pulses inside the clip', () => {
    const c = buildRetailClip(input({ durationSec: 4 })) as any;
    const price = layers(c).find((l) => l.source === '$19.00')!;
    expect(price.transform.scale.length).toBeGreaterThan(4);
    expect(Math.max(...price.transform.scale.map((k: any) => k.t))).toBeLessThanOrEqual(120);
  });
});

describe('retailLayout: the badge and the brand sit in free space, any aspect, any pack, framed or not', () => {
  const packs = [{ width: 256, height: 752 }, { width: 1000, height: 600 }, { width: 800, height: 800 }, { width: 3000, height: 400 }, { width: 400, height: 1500 }];
  const sizes: Array<[number, number]> = [[1080, 1920], [1920, 1080], [1080, 1080]];
  it('never overlaps the pack, the caption zone or each other, and stays in the frame', () => {
    for (const [W, H] of sizes) {
      for (const product of packs) {
        for (const frame of [false, true]) {
          const L = retailLayout(W, H, product, { frame, brand: true });
          const disc: Rect = { x: L.badge.cx - L.badge.d / 2, y: L.badge.cy - L.badge.d / 2, w: L.badge.d, h: L.badge.d };
          if (L.badge.d > 0) {
            expect(hit(L.pack, disc)).toBe(false);
            expect(hit(L.captionZone, disc)).toBe(false);
            expect(disc.x).toBeGreaterThanOrEqual(0);
            expect(disc.y).toBeGreaterThanOrEqual(0);
            expect(disc.x + disc.w).toBeLessThanOrEqual(W);
            if (L.brand) expect(hit(L.brand, disc)).toBe(false);
          }
          if (L.brand) {
            expect(hit(L.brand, L.pack)).toBe(false);
            expect(L.brand.x).toBeGreaterThanOrEqual(0);
            expect(L.brand.x + L.brand.w).toBeLessThanOrEqual(W);
          }
          expect(L.pack.y + L.pack.h).toBeLessThanOrEqual(L.captionZone.y);
        }
      }
    }
  });

  it('honours a requested slot when it is free, and falls back when it is not', () => {
    const free = retailLayout(1080, 1920, { width: 256, height: 752 }, { badgeSlot: 'top-left' });
    expect(free.badge.slot).toBe('top-left');
    const tight = retailLayout(1080, 1920, { width: 3000, height: 400 }, { badgeSlot: 'right' });
    expect(['right', 'none']).toContain(tight.badge.slot);
  });
});

describe('price type', () => {
  it.each([[4.5], [19], [1299.99]])('fits inside the badge disc for %s', (price) => {
    const c = buildRetailClip(input({ price })) as any;
    const discs = ellipses(c).filter((l) => !l.effects && !l.blendMode).sort((a, b) => a.path.size[0] - b.path.size[0]);
    const text = layers(c).find((l) => l.source?.includes(String(Math.floor(price))))!;
    expect(text.source.length * text.style.size * 0.62).toBeLessThanOrEqual(discs[0]!.path.size[0]);
  });
});

describe('pulseKeys', () => {
  it('stays ascending and within the duration', () => {
    for (const d of [2.5, 3, 4, 6]) {
      const k = pulseKeys(d);
      expect(k.every(([t], i) => i === 0 || t > k[i - 1]![0])).toBe(true);
      expect(k[k.length - 1]![0]).toBeLessThanOrEqual(d);
    }
  });
});

describe('pulseKeys on the beat', () => {
  it('lands the price on beat 2 and peaks each pulse on a beat', () => {
    const k = pulseKeys(4, 120);
    const peaks = k.filter(([, v]) => v > 1).map(([t]) => t);
    expect(peaks[0]).toBe(1); // beat 2 at 120 BPM
    for (const t of peaks) expect((t / 0.5) % 1).toBeCloseTo(0, 5);
  });
  it('follows the tempo and slams for a promo', () => {
    expect(pulseKeys(4, 90).find(([, v]) => v > 1)![0]).toBeCloseTo(1.33, 2);
    const slam = pulseKeys(4, 120, 'slam');
    expect(Math.max(...slam.map(([, v]) => v))).toBeGreaterThan(1.3);
  });
});

describe('looks', () => {
  const ids = ['tabletop-hero', 'flat-lay', 'studio-pedestal', 'lifestyle-room', 'ingredient-orbit', 'price-promo'] as const;

  it.each(ids)('%s builds deterministically on every aspect, with the claim on screen', (look) => {
    for (const aspect of ['9:16', '16:9', '1:1'] as const) {
      const a = buildRetailClip(input({ look, aspect, frame: true, wasPrice: 24 }));
      expect(a).toEqual(buildRetailClip(input({ look, aspect, frame: true, wasPrice: 24 })));
      const texts = layers(a).filter((l) => l.kind === 'text').map((l) => l.source);
      expect(texts).toEqual(expect.arrayContaining(['$19.00', 'Stone Mug 350ml']));
    }
  });

  it('the light sweep travels across the pack inside its bounds, and only in looks that ask for it', () => {
    const c = buildRetailClip(input({ look: 'tabletop-hero' })) as any;
    const L = retailLayout(1080, 1920, input().product, { brand: true });
    const band = layers(c).find((l) => l.kind === 'shape' && l.blendMode === 'screen' && Array.isArray(l.transform.opacity) && l.path.kind === 'rect')!;
    const xs = band.transform.position.map((k: any) => k.v[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(L.pack.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(L.pack.x + L.pack.w);
    expect(xs[xs.length - 1]).toBeGreaterThan(xs[0]);
    expect(band.transform.opacity[band.transform.opacity.length - 1].v).toBe(0); // fades out at the far edge
    const flat = buildRetailClip(input({ look: 'flat-lay' })) as any;
    expect(layers(flat).some((l) => l.kind === 'shape' && l.blendMode === 'screen' && l.path.kind === 'rect' && Array.isArray(l.transform.opacity))).toBe(false);
  });

  it('never uses track mattes or masks (the player draws them empty inside a scene)', () => {
    for (const look of ['tabletop-hero', 'studio-pedestal', 'flat-lay'] as const) {
      expect(layers(buildRetailClip(input({ look, frame: true }))).some((l) => l.trackMatte || l.masks)).toBe(false);
    }
  });

  it('the shadow falls away from the light', () => {
    const c = buildRetailClip(input({ look: 'tabletop-hero' })) as any;
    const pack = layers(c).find((l) => l.id === 'clip:product')!;
    expect(pack.effects[0].params.direction).toBeLessThan(180); // light from the left, shadow to the right
  });

  it('the pedestal mirrors the pack on the floor, flipped and faint', () => {
    const c = buildRetailClip(input({ look: 'studio-pedestal' })) as any;
    const refl = layers(c).find((l) => l.assetId === 'ast_prod' && l.transform.scale[0]?.v?.[1] < 0)!;
    expect(refl).toBeTruthy();
    expect(Math.max(...refl.transform.opacity.map((k: any) => k.v))).toBeLessThan(0.3);
  });

  it('the promo draws its own world, ignores the plate and strikes the old price', () => {
    const c = buildRetailClip(input({ look: 'price-promo', wasPrice: 24 })) as any;
    expect(Object.keys(c.assets)).not.toContain('ast_plate');
    expect(layers(c).some((l) => l.path?.kind === 'polystar')).toBe(true);
    expect(layers(c).some((l) => l.source === '$24.00')).toBe(true);
    // the field is a deeper shade than the accent, so the badge ring stays visible
    expect(layers(c).some((l) => l.fill === shade('#0a7a3d', 0.45))).toBe(true);
    expect(shade('#7a3b12', 0.5)).toBe('#3d1e09');
  });

  it('confetti and bokeh stay out of the caption zone at the end', () => {
    for (const look of ['flat-lay', 'tabletop-hero'] as const) {
      const c = buildRetailClip(input({ look })) as any;
      const L = retailLayout(1080, 1920, input().product, { brand: true });
      const air = layers(c).filter((l) => l.kind === 'shape' && Array.isArray(l.transform.position) && typeof l.transform.position[0] === 'object' && l.id !== 'clip:product');
      for (const l of air) {
        const last = l.transform.position[l.transform.position.length - 1].v[1];
        if (l.transform.rotation !== undefined && typeof l.transform.rotation === 'object') expect(last).toBeLessThan(L.captionZone.y);
      }
    }
  });
});
