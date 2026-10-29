import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { addLayer, addScene, newFilmComposition } from '../../authoring/api';
import { makeTestDeps } from '../../test-utils/deps';
import { createApp } from '../app';
import { registerReviewRoutes } from './review';
import { findFix, recordFixes, clearFixes } from '../../review/fix-log';
import { compareGeometry, measuredForRules } from '../../review/compare';
import { setKeyframes } from '../../authoring/api';
import { layerBoxAt } from '../../review/geometry';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';

const png = (c = '#808080') =>
  // a mark on the picture: a frame of one flat colour counts as blank and is skipped by the review
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${c}"/><rect x="4" y="4" width="12" height="12" fill="#ffffff"/></svg>`))
    .png()
    .toBuffer();

async function filmWithScene(deps: Awaited<ReturnType<typeof makeTestDeps>>) {
  let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
  comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'motion', intent: 'hero' });
  comp = addLayer(comp, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  comp = addLayer(comp, { sceneId: 's1', role: 'caption', kind: 'text', text: 'Slow mornings', box: { x: 200, y: 300, w: 300, h: 80 } });
  await deps.films.commit(deps.filmId, comp, 'director');
}

const form = async (
  files: Array<{ name: string; bytes: Uint8Array | string; type?: string }>,
  meta: unknown,
  extra: Record<string, string> = {},
) => {
  const f = new FormData();
  for (const x of files)
    f.append(
      'frames',
      new File([typeof x.bytes === 'string' ? x.bytes : Uint8Array.from(x.bytes)], x.name, { type: x.type ?? 'image/png' }),
    );
  if (meta !== undefined) f.set('meta', JSON.stringify(meta));
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};

describe('POST /api/films/:id/frames', () => {
  it('stores three frames, sets reviewing before the review runs and answers 202', async () => {
    const base = await makeTestDeps();
    await filmWithScene(base);
    const seenStatus: string[] = [];
    const app = new Hono();
    registerReviewRoutes(app, base, {
      run: async () => {
        seenStatus.push((await base.films.get(base.filmId)).status);
      },
    });
    const bytes = await png();
    const meta = [0.8, 2, 3.2].map((atSec) => ({ sceneId: 's1', atSec }));
    const res = await app.request(`/api/films/${base.filmId}/frames`, {
      method: 'POST',
      body: await form(
        [1, 2, 3].map((n) => ({ name: `f${n}.png`, bytes })),
        meta,
      ),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ review: 'started', frames: 3, geometry: null });
    const assets = (await base.assets.list()).filter((a) => a.role === 'frame');
    expect(assets).toHaveLength(3);
    expect(assets.every((a) => a.sceneId === 's1' && a.filmId === base.filmId)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(seenStatus).toEqual(['reviewing']);
  });

  it('refuses a second request while reviewing, and rejects bad input', async () => {
    const base = await makeTestDeps();
    await filmWithScene(base);
    const app = new Hono();
    registerReviewRoutes(app, base, { run: () => new Promise(() => undefined) });
    const bytes = await png();
    const one = (over: object = {}) => form([{ name: 'f.png', bytes }], [{ sceneId: 's1', atSec: 1 }], over as never);
    expect((await app.request(`/api/films/${base.filmId}/frames`, { method: 'POST', body: await one() })).status).toBe(202);
    expect((await app.request(`/api/films/${base.filmId}/frames`, { method: 'POST', body: await one() })).status).toBe(409);

    const fresh = await makeTestDeps();
    await filmWithScene(fresh);
    const app2 = new Hono();
    registerReviewRoutes(app2, fresh, { run: async () => undefined });
    const url = `/api/films/${fresh.filmId}/frames`;
    const three = await form(
      [1, 2, 3].map((n) => ({ name: `f${n}.png`, bytes })),
      [
        { sceneId: 's1', atSec: 1 },
        { sceneId: 's1', atSec: 2 },
      ],
    );
    expect((await app2.request(url, { method: 'POST', body: three })).status).toBe(400);
    const unknown = await form([{ name: 'f.png', bytes }], [{ sceneId: 's9', atSec: 1 }]);
    const r = await app2.request(url, { method: 'POST', body: unknown });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('s9');
    const text = await form([{ name: 'frame.png', bytes: 'hello', type: 'text/plain' }], [{ sceneId: 's1', atSec: 1 }]);
    expect((await app2.request(url, { method: 'POST', body: text })).status).toBe(415);
    const big = await form([{ name: 'big.png', bytes: new Uint8Array(4.5 * 1024 * 1024) }], [{ sceneId: 's1', atSec: 1 }]);
    expect((await app2.request(url, { method: 'POST', body: big })).status).toBe(413);
    const many = await form(
      Array.from({ length: 25 }, (_, i) => ({ name: `f${i}.png`, bytes })),
      Array.from({ length: 25 }, () => ({ sceneId: 's1', atSec: 1 })),
    );
    expect((await app2.request(url, { method: 'POST', body: many })).status).toBe(413);
  });

  it('lets only one of two simultaneous uploads start a review', async () => {
    const base = await makeTestDeps();
    await filmWithScene(base);
    let runs = 0;
    const app = new Hono();
    registerReviewRoutes(app, base, {
      run: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 30));
        await base.films.update(base.filmId, { status: 'ready' }); // as runReview does
      },
    });
    const bytes = await png();
    const send = async () =>
      app.request(`/api/films/${base.filmId}/frames`, {
        method: 'POST',
        body: await form([{ name: 'f.png', bytes }], [{ sceneId: 's1', atSec: 1 }]),
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    await new Promise((r) => setTimeout(r, 60));
    expect(runs).toBe(1);
    // once the first review is done the film accepts another
    expect((await send()).status).toBe(202);
  });

  it('rejects malformed textBoxes with a 400 before storing any frame', async () => {
    const base = await makeTestDeps();
    await filmWithScene(base);
    const app = new Hono();
    registerReviewRoutes(app, base, { run: async () => undefined });
    const bytes = await png();
    for (const bad of [
      { 's1:caption': {} },
      { 's1:caption': { frame: 'x', box: { left: 0, top: 0, right: 1, bottom: 1 } } },
      { 's1:caption': { frame: 3, box: { left: 0, top: 0, right: 'a', bottom: 1 } } },
      [1, 2],
    ]) {
      const res = await app.request(`/api/films/${base.filmId}/frames`, {
        method: 'POST',
        body: await form([{ name: 'f.png', bytes }], [{ sceneId: 's1', atSec: 1 }], { textBoxes: JSON.stringify(bad) }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('bad_text_boxes');
    }
    expect((await base.assets.list()).filter((a) => a.role === 'frame')).toHaveLength(0);
    expect((await base.films.get(base.filmId)).status).not.toBe('reviewing');
  });

  it('returns to ready and emits a status event when the review throws', async () => {
    const base = await makeTestDeps();
    await filmWithScene(base);
    const app = new Hono();
    registerReviewRoutes(app, base, {
      run: async () => {
        throw new Error('boom');
      },
    });
    const bytes = await png();
    await app.request(`/api/films/${base.filmId}/frames`, {
      method: 'POST',
      body: await form([{ name: 'f.png', bytes }], [{ sceneId: 's1', atSec: 1 }]),
    });
    await new Promise((r) => setTimeout(r, 40));
    expect((await base.films.get(base.filmId)).status).toBe('ready');
    expect(base.events.some((e) => e.type === 'error' && e.where === 'review' && e.message === 'boom')).toBe(true);
  });

  it('resets a film left in reviewing when routes register, with one status event', async () => {
    const base = await makeTestDeps();
    await base.films.update(base.filmId, { status: 'reviewing' });
    registerReviewRoutes(new Hono(), base, { run: async () => undefined });
    await new Promise((r) => setTimeout(r, 40));
    expect((await base.films.get(base.filmId)).status).toBe('ready');
    expect(base.events.filter((e) => e.type === 'film.status' && e.status === 'ready')).toHaveLength(1);
  });

  it('is reachable through the real app and answers 400 for an empty body, not 501', async () => {
    const app = createApp(await makeTestDeps());
    const res = await app.request('/api/films/film_3fa9c2d41b7e/frames', { method: 'POST' });
    expect(res.status).not.toBe(501);
    expect([400, 404]).toContain(res.status);
  });

  it('pairs an after frame with its recorded fix and emits review.fix', async () => {
    const base = await makeTestDeps();
    await filmWithScene(base);
    clearFixes(base.filmId);
    recordFixes(base.filmId, [{ sceneId: 's1', atSec: 0.8, note: 'setTransform s1:caption', beforeFrame: 'ast_before' }]);
    const app = new Hono();
    registerReviewRoutes(app, base, { run: async () => undefined });
    const res = await app.request(`/api/films/${base.filmId}/frames?phase=after`, {
      method: 'POST',
      body: await form([{ name: 'a.png', bytes: await png('#ffffff') }], [{ sceneId: 's1', atSec: 0.8 }]),
    });
    expect(await res.json()).toEqual({ stored: 1 });
    await new Promise((r) => setTimeout(r, 20));
    const fixes = base.events.filter((e) => e.type === 'review.fix');
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ beforeFrame: 'ast_before', note: 'setTransform s1:caption' });
    expect((fixes[0] as { afterFrame?: string }).afterFrame).toMatch(/^ast_/);
  });

  it('stores an after frame with no recorded fix silently, and checks the film and meta', async () => {
    const base = await makeTestDeps();
    await filmWithScene(base);
    clearFixes(base.filmId);
    const statusBefore = (await base.films.get(base.filmId)).status;
    const app = new Hono();
    registerReviewRoutes(app, base, { run: async () => undefined });
    const ok = await app.request(`/api/films/${base.filmId}/frames?phase=after`, {
      method: 'POST',
      body: await form([{ name: 'a.png', bytes: await png() }], [{ sceneId: 's1', atSec: 3 }]),
    });
    expect(await ok.json()).toEqual({ stored: 1 });
    expect(base.events.filter((e) => e.type === 'review.fix')).toHaveLength(0);
    expect((await base.films.get(base.filmId)).status).toBe(statusBefore);
    const missing = await app.request('/api/films/film_000000000000/frames?phase=after', {
      method: 'POST',
      body: await form([{ name: 'a.png', bytes: await png() }], [{ sceneId: 's1', atSec: 3 }]),
    });
    expect(missing.status).toBe(404);
    const badMeta = await app.request(`/api/films/${base.filmId}/frames?phase=after`, {
      method: 'POST',
      body: await form([{ name: 'a.png', bytes: await png() }], [{ sceneId: 's1' }, { sceneId: 's1' }]),
    });
    expect(badMeta.status).toBe(400);
    expect(findFix(base.filmId, 's1', 3)).toBeUndefined();
  });
});

describe('geometry comparison', () => {
  it('reports the relative error of the model box against a measured box', async () => {
    let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
    comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'motion', intent: 'hero' });
    comp = addLayer(comp, { sceneId: 's1', role: 'caption', kind: 'text', text: 'Slow', box: { x: 190, y: 800, w: 1540, h: 67.2 } });
    const model = layerBoxAt(comp as AepCompositionJson, 's1:caption', 15).box;
    const measured = {
      's1:caption': { frame: 15, box: { left: model.left + 10, top: model.top, right: model.right + 10, bottom: model.bottom + 2.8 } },
    };
    const out = compareGeometry(comp as AepCompositionJson, measured);
    expect(out!.layers).toBe(1);
    expect(Math.abs(out!.maxRelError - 10 / 1920)).toBeLessThan(0.0001);
    expect(compareGeometry(comp as AepCompositionJson, {})).toBeNull();
    expect(compareGeometry(comp as AepCompositionJson, { 's1:ghost': { frame: 1, box: model } })).toBeNull();
  });

  it('leaves out keyframed layers when the rules use measured boxes', async () => {
    let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
    comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'motion', intent: 'hero' });
    comp = addLayer(comp, { sceneId: 's1', role: 'caption', kind: 'text', text: 'Slow', box: { x: 100, y: 100, w: 300, h: 80 } });
    comp = addLayer(comp, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Hi', box: { x: 100, y: 300, w: 300, h: 80 } });
    comp = setKeyframes(comp, 's1:headline', 'x', [
      [0, 100],
      [2, 300],
    ]);
    const box = { left: 0, top: 0, right: 10, bottom: 10 };
    const out = measuredForRules(comp as AepCompositionJson, { 's1:caption': { frame: 1, box }, 's1:headline': { frame: 1, box } });
    expect(Object.keys(out)).toEqual(['s1:caption']);
  });
});
