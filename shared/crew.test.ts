import { describe, expect, it } from 'vitest';
import { JOB_PRIORITY, WRITING_KINDS, inboxItemSchema, jobSchema, styleBibleSchema, storyboardOpSchema } from './crew';

const scene = { durationSec: 4, intent: 'hero shot', shotType: 'hero', camera: 'dolly-in', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'a still is enough' } as const;
const job = { id: 'j1', kind: 'build-scene', sceneId: 's1', filmId: 'film_a', brief: 'b', reason: 'r', origin: 'auto', status: 'queued', createdAt: '2026-10-30T00:00:00Z', costUsd: 0 };
const bible = { palette: ['#1f2937', '#f59e0b'], light: 'warm', camera: 'slow', type: { font: 'sans', weight: 700, case: 'upper' }, productLine: 'a can', mood: 'calm' };

describe('styleBibleSchema', () => {
  it('accepts hex colours and rejects a colour name', () => {
    expect(styleBibleSchema.safeParse(bible).success).toBe(true);
    expect(styleBibleSchema.safeParse({ ...bible, palette: ['orange', '#f59e0b'] }).success).toBe(false);
  });
  it('rejects one colour and an over-long light line', () => {
    expect(styleBibleSchema.safeParse({ ...bible, palette: ['#1f2937'] }).success).toBe(false);
    expect(styleBibleSchema.safeParse({ ...bible, light: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('storyboardOpSchema', () => {
  it('needs `after` on a move, but a move to the front is null', () => {
    expect(storyboardOpSchema.safeParse({ op: 'move', sceneId: 's2', after: null }).success).toBe(true);
    expect(storyboardOpSchema.safeParse({ op: 'move', sceneId: 's2' }).success).toBe(false);
  });
  it('accepts an add with no id, with or without `after`', () => {
    expect(storyboardOpSchema.safeParse({ op: 'add', scene }).success).toBe(true);
    expect(storyboardOpSchema.safeParse({ op: 'add', scene, after: 's2' }).success).toBe(true);
  });
  it('accepts update and remove, rejects an unknown op and a bad patch', () => {
    expect(storyboardOpSchema.safeParse({ op: 'update', sceneId: 's1', patch: { camera: 'pan' } }).success).toBe(true);
    expect(storyboardOpSchema.safeParse({ op: 'remove', sceneId: 's1' }).success).toBe(true);
    expect(storyboardOpSchema.safeParse({ op: 'swap', sceneId: 's1' }).success).toBe(false);
    expect(storyboardOpSchema.safeParse({ op: 'update', sceneId: 's1', patch: { camera: 'zoom' } }).success).toBe(false);
  });
});

describe('jobSchema and inboxItemSchema', () => {
  it('parses a queued job and rejects a status the board does not have', () => {
    expect(jobSchema.safeParse(job).success).toBe(true);
    expect(jobSchema.safeParse({ ...job, status: 'paused' }).success).toBe(false);
  });
  it('limits the brief to 600 characters', () => {
    expect(jobSchema.safeParse({ ...job, brief: 'x'.repeat(601) }).success).toBe(false);
  });
  it('parses an inbox item and rejects an unknown sender', () => {
    const item = { id: 'i1', at: '2026-10-30T00:00:00Z', from: 'user', text: 'warmer light' };
    expect(inboxItemSchema.safeParse(item).success).toBe(true);
    expect(inboxItemSchema.safeParse({ ...item, from: 'bot' }).success).toBe(false);
  });
});

describe('JOB_PRIORITY and WRITING_KINDS', () => {
  it('puts the user first and an automatic critique last', () => {
    expect(JOB_PRIORITY({ origin: 'user', kind: 'build-scene' })).toBe(0);
    expect(JOB_PRIORITY({ origin: 'auto', kind: 'critique' })).toBe(4);
  });
  it('ranks fix, writing, take in that order', () => {
    expect(JOB_PRIORITY({ origin: 'showrunner', kind: 'fix' })).toBe(1);
    expect(JOB_PRIORITY({ origin: 'showrunner', kind: 'restyle-scene' })).toBe(2);
    expect(JOB_PRIORITY({ origin: 'showrunner', kind: 'take' })).toBe(3);
    expect(JOB_PRIORITY({ origin: 'auto', kind: 'continuity' })).toBe(4);
  });
  it('holds restyle-scene but neither critique nor take', () => {
    expect(WRITING_KINDS).toContain('restyle-scene');
    expect(WRITING_KINDS).not.toContain('critique');
    expect(WRITING_KINDS).not.toContain('take');
  });
});
