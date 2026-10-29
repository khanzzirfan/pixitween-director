import { expect, it } from 'vitest';
import { filmEventSchema, makeEvent } from './events';

const filmId = 'film_3fa9c2d41b7e';
const at = '2026-10-28T02:14:09.311Z';
const asset = { id: 'ast_0123456789abcdef0123456789abcdef', url: '/api/assets/x', mime: 'image/png' };
const storyboard = {
  title: 'T',
  aspect: '16:9',
  durationSec: 8,
  palette: ['#112233'],
  scenes: [1, 2].map((n) => ({
    id: `s${n}`, durationSec: 4, intent: 'i', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'r',
  })),
};

const rows: Array<[string, Record<string, unknown>]> = [
  ['film.status', { status: 'planning' }],
  ['listener.transcript', { text: 'hello' }],
  ['director.storyboard', { storyboard }],
  ['agent.turn', { backend: 'spark', ms: 1200, calls: 6, reply: 'Done' }],
  ['tool.call', { name: 'addScene', args: { id: 's1' }, ok: true, version: 2 }],
  ['art.asset', { asset }],
  ['review.finding', { sceneId: 's1', kind: 'low-contrast', atSec: 1, evidence: 'ratio 2.1', deterministic: true }],
  ['review.fix', { sceneId: 's1', note: 'moved text' }],
  ['generate.proposed', { sceneId: 's2', reason: 'pour', estCredits: 25, token: 'tok' }],
  ['generate.progress', { sceneId: 's2', status: 'queued' }],
  ['generate.done', { sceneId: 's2', asset }],
  ['cost', { usd: 0.01, model: 'muse-image', units: '1 image' }],
  ['error', { where: 'meta.spark', status: 500, message: 'boom' }],
];

const CREW_VARIANTS = 9; // S12a; each one is parsed in events.crew.test.ts

it('has exactly 13 original variants, one table row each, plus the crew ones', () => {
  expect(filmEventSchema.options).toHaveLength(13 + CREW_VARIANTS);
  expect(rows).toHaveLength(13);
});

it.each(rows)('parses %s', (type, extra) => {
  expect(filmEventSchema.safeParse({ filmId, at, type, ...extra }).success).toBe(true);
});

it('rejects an unknown type and a bad filmId (path filmId)', () => {
  expect(filmEventSchema.safeParse({ filmId, at, type: 'nope' }).success).toBe(false);
  const r = filmEventSchema.safeParse({ filmId: 'film_x', at, type: 'listener.transcript', text: 'x' });
  expect(!r.success && r.error.issues[0]?.path).toEqual(['filmId']);
});

it('makeEvent stamps an ISO at and validates', () => {
  const e = makeEvent(filmId, { type: 'cost', usd: 0, model: 'clippy', units: 'animate fast-h3', credits: 25 });
  expect(filmEventSchema.safeParse(e).success).toBe(true);
  expect(e.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/);
  expect(filmEventSchema.safeParse(makeEvent(filmId, { type: 'agent.turn', backend: 'glimmer', ms: 1, calls: 0, reply: 'Done' })).success).toBe(true);
});
