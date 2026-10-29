import { describe, expect, it } from 'vitest';
import { filmEventSchema, makeEvent } from './events';

const filmId = 'film_0123456789ab';
const at = '2026-10-30T00:00:00Z';
const job = { id: 'j1', kind: 'build-scene', sceneId: 's1', filmId, brief: 'b', reason: 'r', origin: 'auto', status: 'queued', createdAt: at, costUsd: 0 };
const scene = { id: 's1', durationSec: 4, intent: 'x', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'm' };
const storyboard = { title: 't', aspect: '16:9', durationSec: 8, palette: ['#111111'], scenes: [scene, { ...scene, id: 's2' }] };
const bible = { palette: ['#1f2937', '#f59e0b'], light: 'warm', camera: 'slow', type: { font: 'Inter', weight: 700, case: 'upper' }, productLine: 'a can', mood: 'calm' };

const examples: Record<string, object> = {
  'crew.agent': { lane: 'builder', worker: 'builder-1', state: 'working', jobId: 'j1' },
  'job.update': { job },
  'showrunner.heard': { inboxId: 'i1', from: 'user', text: 'warmer' },
  'showrunner.say': { kind: 'note', text: 'Four scenes.' },
  'storyboard.revised': { rev: 1, source: 'user', ops: [{ op: 'remove', sceneId: 's3' }], storyboard },
  'style.bible': { bible },
  'take.ready': { jobId: 'j2', takeOf: 'j1', sceneId: 's1', label: 'A', takeFilmId: filmId },
  'capture.request': { requestId: 'r1', sceneId: 's1', timesSec: [0.5, 2] },
  budget: { spentUsd: 0.8, capUsd: 1, level: 'warn' },
};

describe('crew events', () => {
  it.each(Object.entries(examples))('%s parses', (type, body) => {
    expect(filmEventSchema.safeParse({ filmId, at, type, ...body }).success).toBe(true);
  });
  it('rejects a job.update whose status is paused', () => {
    expect(filmEventSchema.safeParse({ filmId, at, type: 'job.update', job: { ...job, status: 'paused' } }).success).toBe(false);
  });
  it('accepts agent.turn with backend wonder', () => {
    expect(filmEventSchema.safeParse({ filmId, at, type: 'agent.turn', backend: 'wonder', ms: 1, calls: 2 }).success).toBe(true);
  });
  it('makeEvent fills `at` on a crew event', () => {
    const e = makeEvent(filmId, { type: 'budget', spentUsd: 0, capUsd: 1, level: 'ok' });
    expect(Number.isNaN(Date.parse(e.at))).toBe(false);
  });
});
