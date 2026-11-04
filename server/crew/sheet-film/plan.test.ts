import { describe, expect, it } from 'vitest';
import { storyboardSchema } from '@shared/storyboard';
import { floorElements } from '../../authoring/ingredients';
import type { CinematicBoard } from '../../authoring/beatsheet';
import { askedSeconds, secondsIn, storyboardFromBoard } from './plan';

const boardOf = (secs: number[]): CinematicBoard => {
  const elements = floorElements('Yoghurt', 'food');
  return { concept: 'a yoghurt', mood: 'bright', elements, sheet: { beats: secs.map((seconds, i) => ({ size: 'wide' as const, move: i % 2 ? ('orbit' as const) : ('push' as const), seconds, blur: 0.3, phase: (['hook', 'build', 'peak', 'reveal', 'close'] as const)[i % 5], ...(i === 0 ? { text: 'Pure Spoonful' } : {}) })) } };
};

describe('secondsIn and askedSeconds', () => {
  it('reads the length the brief asks for', () => {
    expect(secondsIn('Cinematic 10s vertical (9:16) yoghurt ad')).toBe(10);
    expect(secondsIn('a 6 second film')).toBe(6);
    expect(secondsIn('version 2')).toBeUndefined();
    expect(secondsIn('a 2s blink')).toBeUndefined();
  });
  it('defaults to 8 and caps at 10', () => {
    expect(askedSeconds('no length given')).toBe(10);
    expect(askedSeconds('a 15s film')).toBe(15);
    expect(askedSeconds('a 30 second film')).toBe(30);
    expect(askedSeconds('a 45s film')).toBe(10);
  });
});

describe('storyboardFromBoard', () => {
  it('groups beats into 3d scenes of 2 to 8 s that keep the total', () => {
    const sb = storyboardFromBoard(boardOf([1.2, 2, 1.8, 2.3, 2.7]), { title: 'Yoghurt', aspect: '9:16' });
    expect(() => storyboardSchema.parse(sb)).not.toThrow();
    for (const s of sb.scenes) {
      expect(s.durationSec).toBeGreaterThanOrEqual(2);
      expect(s.durationSec).toBeLessThanOrEqual(8);
      expect(s.mode).toBe('3d');
    }
    expect(sb.scenes.reduce((n, s) => n + s.durationSec, 0)).toBeCloseTo(10, 5);
    expect(sb.durationSec).toBe(10);
    expect(sb.scenes.map((s) => s.id)).toEqual(sb.scenes.map((_, i) => `shot-${i + 1}`));
    expect(sb.scenes[0]!.text).toBe('Pure Spoonful');
  });
});
