import { describe, expect, it } from 'vitest';
import { buildAnimateRequest, buildClipPrompt, clipSecondsFor, snapOmniSeconds, wantsSound } from './request';

describe('durations', () => {
  it('clips', () => {
    expect(clipSecondsFor('fast-h3', 3)).toBe(5.2);
    expect(clipSecondsFor('fast-h3', 12)).toBe(10);
    expect(clipSecondsFor('fast-h3', 7.04)).toBe(7);
    expect(clipSecondsFor('fast-h3-omni', 6)).toBe(8);
    expect(clipSecondsFor('fast-h3-omni', 4)).toBe(5.875);
    expect(clipSecondsFor('fast-h3-omni', 8)).toBe(8);
    expect(snapOmniSeconds(5.875)).toBe(5.875);
  });
});

describe('wantsSound', () => {
  it('matches the sound words', () => {
    for (const t of ['coffee pours', 'a SPLASH of milk', 'steaming cup', 'it sizzles']) expect(wantsSound(t), t).toBe(true);
    expect(wantsSound('a slow reveal')).toBe(false);
  });
});

describe('buildClipPrompt', () => {
  it('trims a long intent at a sentence boundary under 800 characters', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about the steaming cup on the table.`).join(' ');
    const p = buildClipPrompt({ intent: long, camera: 'pan' });
    expect(p.length).toBeLessThanOrEqual(800);
    expect(/[.!?]$/.test(p)).toBe(true);
    expect(p).toContain('No text, no logos, no extra products.');
  });
  it('trims a 2000-character run of words at a word boundary', () => {
    const p = buildClipPrompt({ intent: 'cup '.repeat(500), camera: 'static' });
    expect(p.length).toBeLessThanOrEqual(800);
    expect(/[.!?]$/.test(p)).toBe(true);
    expect(p).not.toMatch(/\bcu\b|\bcup\.cup/);
  });
  it('adds the retry sentence and the omni lines', () => {
    expect(buildClipPrompt({ intent: 'x', camera: 'static', adjust: true })).toContain('Keep the product clearly visible in frame for the whole clip');
    const o = buildClipPrompt({ intent: 'pour', camera: 'dolly-in', omni: true });
    expect(o).toContain('Ambient sound only, no speech, no music.');
    expect(o).toContain('<Picture 1>');
    expect(o).toContain('<Picture 2>');
    expect(o).toContain('Slow push-in');
  });
});

describe('buildAnimateRequest', () => {
  const base = { filmId: 'film1', aspect: '9:16' as const, stillUrl: 'https://app.example.test/api/assets/a1', attempt: 1 };
  it('picks omni for sound intents', () => {
    const r = buildAnimateRequest({ ...base, scene: { id: 's2', durationSec: 7, intent: 'coffee pours into a cup', camera: 'static' }, productPhotoUrl: 'https://app.example.test/api/assets/p1' });
    expect(r).toMatchObject({ model: 'fast-h3-omni', aspect: '9:16', durationSec: 8, idempotencyKey: 'film1:s2:1' });
    expect((r as { imageUrls: string[] }).imageUrls).toEqual([base.stillUrl, 'https://app.example.test/api/assets/p1']);
  });
  it('picks fast-h3 for silent intents', () => {
    const r = buildAnimateRequest({ ...base, scene: { id: 's2', durationSec: 7, intent: 'a slow reveal', camera: 'static' } });
    expect(r).toMatchObject({ model: 'fast-h3', sourceImageUrl: base.stillUrl, durationSec: 7 });
  });
  it('rejects http still URLs', () => {
    expect(() => buildAnimateRequest({ ...base, stillUrl: 'http://app.example.test/a1', scene: { id: 's2', durationSec: 7, intent: 'x', camera: 'static' } })).toThrow();
  });
});
