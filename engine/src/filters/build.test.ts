import { BlurFilter, type NoiseFilter } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { gsap } from 'gsap';
import { describe, expect, it, vi } from 'vitest';
import { hashString, seedFor } from '../core/seed';
import { buildFilters } from './build';

describe('buildFilters', () => {
  it('builds the enabled specs, skips a disabled one and reports no errors', () => {
    const built = buildFilters([
      { id: 'g', type: 'glow', params: { outerStrength: 2 } },
      { id: 'b', type: 'blur', enabled: false },
    ]);

    expect(built.filters).toHaveLength(1);
    expect(built.filters[0]).toBeInstanceOf(GlowFilter);
    expect([...built.byId.keys()]).toEqual(['g']);
    expect(built.errors).toEqual([]);
  });

  it('reports an unknown param but still creates the filter', () => {
    const built = buildFilters([{ id: 'b', type: 'blur', params: { foo: 1 } }]);

    expect(built.errors).toHaveLength(1);
    expect(built.errors[0]).toContain('foo');
    expect(built.byId.has('b')).toBe(true);
    expect(built.filters[0]).toBeInstanceOf(BlurFilter);
  });

  it('tweens a number param on the live filter through the proxy target', () => {
    const built = buildFilters([{ id: 'g', type: 'glow', params: { outerStrength: 2 } }]);
    const glow = built.byId.get('g')!.filter as GlowFilter;
    const ref = built.resolveTarget('g', 'outerStrength')!;

    expect(glow.outerStrength).toBe(2);

    const tween = gsap.to(ref.obj, { [ref.key]: 0, duration: 1, ease: 'none' });
    tween.progress(0.5);
    expect(glow.outerStrength).toBeCloseTo(1, 5);

    tween.progress(1);
    expect(glow.outerStrength).toBeCloseTo(0, 5);
    tween.kill();
  });

  it('returns null for an unknown param and for an unknown id', () => {
    const built = buildFilters([{ id: 'g', type: 'glow' }]);

    expect(built.resolveTarget('g', 'nope')).toBeNull();
    expect(built.resolveTarget('zz', 'outerStrength')).toBeNull();
  });

  it('exposes a colour target with getColor and setColor', () => {
    const built = buildFilters([{ id: 'g', type: 'glow', params: { color: '#ff0000' } }]);
    const ref = built.resolveTarget('g', 'color')!;

    expect(ref.kind).toBe('color');
    expect(ref.getColor?.()).toBe('#ff0000');

    ref.setColor?.('#00ff00');
    expect(ref.getColor?.()).toBe('#00ff00');
  });

  it('ticks time-driven filters with the id salt', () => {
    const built = buildFilters([{ id: 'n', type: 'noise' }]);
    const noise = built.byId.get('n')!.filter as NoiseFilter;
    const salt = hashString('n');

    built.tick(0.5, 10);
    expect(noise.seed).toBe(seedFor(10, salt));

    built.tick(0.5, 11);
    expect(noise.seed).toBe(seedFor(11, salt));
    expect(noise.seed).not.toBe(seedFor(10, salt));
  });

  it('destroys every filter', () => {
    const built = buildFilters([{ id: 'g', type: 'glow' }, { id: 'b', type: 'blur' }]);
    const spies = built.filters.map((filter) => vi.spyOn(filter, 'destroy'));

    built.destroy();

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
