import { describe, expect, it } from 'vitest';
import { LensStreakEffect, SplitToneEffect } from './grade';

describe('SplitToneEffect', () => {
  it('keeps its colours, amount and balance, and writes them back', () => {
    const e = new SplitToneEffect({ shadows: '#102030', highlights: '#ffcc88', amount: 0.4, balance: -0.2 });
    expect(e.shadows).toBe('#102030');
    expect(e.highlights).toBe('#ffcc88');
    expect(e.amount).toBeCloseTo(0.4, 6);
    e.amount = 0.9;
    e.balance = 0.5;
    e.highlights = '#112233';
    expect(e.uniforms.get('amount')!.value).toBe(0.9);
    expect(e.uniforms.get('balance')!.value).toBe(0.5);
    expect(e.highlights).toBe('#112233');
  });
});

describe('LensStreakEffect', () => {
  it('has defaults, follows the viewport and takes new values', () => {
    const e = new LensStreakEffect();
    expect(e.strength).toBe(0.5);
    expect(e.threshold).toBe(0.8);
    e.setSize(200, 100);
    expect((e.uniforms.get('texel')!.value as { x: number; y: number }).x).toBeCloseTo(0.005, 6);
    e.strength = 1;
    e.color = '#ff8844';
    expect(e.strength).toBe(1);
    expect(e.color).toBe('#ff8844');
  });
});
