import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset, setKeyframes, setTransform } from '../authoring/api';
import { makeTestFilm } from '../test-utils/film';
import { applyFixes, withCommitSource } from './apply';
import { reviewDeterministic, reviewScene, runReview } from './loop';
import { ReviewError, type VisualFrame } from './visual';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';

const png = (c: string) =>
  // a mark on the picture: a frame of one flat colour counts as blank and is skipped by the review
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${c}"/><rect x="4" y="4" width="12" height="12" fill="#ffffff"/></svg>`))
    .png()
    .toBuffer();

/** Scene s1: background, a product photo on the right, and a caption. `captionY` sets the caption's static y. */
async function filmWithCaption(
  o: { captionY?: number; captionBox?: { x: number; y: number; w: number; h: number }; mode?: 'motion' | 'generate' } = {},
) {
  const t = await makeTestFilm();
  const asset = await t.assets.put(await png('#334455'), 'image/png', { role: 'product-photo' });
  let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
  comp = registerAsset(comp, { id: asset.id, kind: 'image', src: asset.url, width: 64, height: 64 });
  comp = addScene(comp, { id: 's1', durationSec: 4, mode: o.mode ?? 'motion', intent: 'hero' });
  comp = addLayer(comp, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  comp = addLayer(comp, { sceneId: 's1', role: 'product', kind: 'image', assetId: asset.id, box: { x: 560, y: 140, w: 800, h: 800 } });
  comp = addLayer(comp, {
    sceneId: 's1',
    role: 'caption',
    kind: 'text',
    text: 'Slow mornings',
    box: o.captionBox ?? { x: 700, y: 400, w: 520, h: 120 },
  });
  if (o.captionY !== undefined) comp = setTransform(comp, 's1:caption', { y: o.captionY });
  await t.films.commit(t.filmId, comp, 'director');
  return { ...t, asset };
}

const noVisual = async () => ({ verdict: { sceneId: 's1', pass: true, issues: [], fixes: [] }, refused: [], dropped: [] });
const frame: VisualFrame = { id: 'f1', atSec: 0.8, image: await png('#808080') };
const captionY = async (t: Awaited<ReturnType<typeof filmWithCaption>>) => {
  const comp = (await t.films.get(t.filmId)).composition as AepCompositionJson;
  return (comp.precomps!.s1 as { layers: Array<{ id: string; transform: { position: [number, number] } }> }).layers.find(
    (l) => l.id === 's1:caption',
  )!.transform.position[1];
};
const events = async (t: { events: Array<{ type: string } & Record<string, unknown>>; bus: unknown }) => {
  await new Promise((r) => setTimeout(r, 30));
  return t.events;
};

describe('reviewDeterministic', () => {
  it('finds the caption over the product without changing the film', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    const before = (await t.films.get(t.filmId)).version;
    const { findings, skipped } = await reviewDeterministic(t.ctx, ['s1']);
    expect(findings.map((f) => f.rule)).toContain('R1');
    expect(skipped).toEqual([]);
    expect((await t.films.get(t.filmId)).version).toBe(before);
    const evs = await events(t);
    expect(evs.some((e) => e.type === 'review.finding' && e.deterministic === true)).toBe(true);
  });
  it('reports an unknown scene as skipped instead of throwing', async () => {
    const t = await filmWithCaption();
    const out = await reviewDeterministic(t.ctx, ['s9']);
    expect(out.findings).toEqual([]);
    expect(out.skipped).toEqual([{ sceneId: 's9', reason: 'unknown scene' }]);
  });
});

describe('reviewScene', () => {
  it('fixes the caption deterministically, shows the status-free fix and leaves no unresolved finding', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    const res = await reviewScene(t.ctx, 's1', [], {});
    expect(res.reverted).toBe(false);
    expect(res.applied).toBeGreaterThan(0);
    expect(await captionY(t)).not.toBe(800);
    const evs = await events(t);
    expect(evs.some((e) => e.type === 'review.fix' && String(e.note).includes('setTransform'))).toBe(true);
  });

  it('applies a grounded visual fix', async () => {
    const t = await filmWithCaption({ captionBox: { x: 200, y: 300, w: 300, h: 80 } });
    const visual = async () => ({
      verdict: {
        sceneId: 's1',
        pass: false,
        issues: [{ image: 1, atSec: 0.8, kind: 'product-hidden', evidence: 'the product is too small to read' }],
        fixes: [{ tool: 'setTransform', args: { layerId: 's1:product', scale: 1.4 } }],
      },
      refused: [],
      dropped: [],
    });
    const res = await reviewScene(t.ctx, 's1', [frame], { visual });
    expect(res.applied).toBe(1);
    expect(res.reverted).toBe(false);
    const comp = (await t.films.get(t.filmId)).composition as AepCompositionJson;
    const product = (comp.precomps!.s1 as { layers: Array<{ id: string; transform: { scale: [number, number] } }> }).layers.find(
      (l) => l.id === 's1:product',
    )!;
    expect(product.transform.scale).toEqual([1.4, 1.4]);
    const evs = await events(t);
    expect(evs.some((e) => e.type === 'review.finding' && e.deterministic === false)).toBe(true);
  });

  it('skips a visual fix that repeats a planned deterministic fix', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    const visual = async () => ({
      verdict: { sceneId: 's1', pass: false, issues: [{ image: 1, atSec: 0.8, kind: 'text-over-product', where: 's1:caption', evidence: 'the caption sits on the product photo' }], fixes: [{ tool: 'setTransform', args: { layerId: 's1:caption', y: 987.4 } }] },
      refused: [],
      dropped: [],
    });
    await reviewScene(t.ctx, 's1', [frame], { visual });
    const evs = await events(t);
    const calls = evs.filter(
      (e) => e.type === 'tool.call' && e.name === 'setTransform' && (e.args as { layerId?: string }).layerId === 's1:caption',
    );
    expect(calls).toHaveLength(1);
  });

  it('reports an unfixable finding after two rounds, running the rules three times and the visual pass once', async () => {
    const t = await filmWithCaption({ captionBox: { x: 200, y: 300, w: 300, h: 80 } });
    const comp = (await t.films.get(t.filmId)).composition as AepCompositionJson;
    const product = (comp.precomps!.s1 as { layers: Array<{ id: string; outPoint?: number }> }).layers.find((l) => l.id === 's1:product')!;
    product.outPoint = 30;
    await t.films.commit(t.filmId, comp, 'user');
    const before = (await t.films.get(t.filmId)).version;
    let visualCalls = 0;
    const visual = async () => {
      visualCalls++;
      return { verdict: { sceneId: 's1', pass: true, issues: [], fixes: [] }, refused: [], dropped: [] };
    };
    const res = await reviewScene(t.ctx, 's1', [frame], { visual });
    expect(visualCalls).toBe(1);
    expect((await t.films.get(t.filmId)).version).toBe(before);
    expect(res.unresolved.map((f) => f.rule)).toContain('R4');
    const evs = await events(t);
    expect(evs.some((e) => e.type === 'review.finding' && String(e.evidence).includes('unresolved after 2 rounds'))).toBe(true);
  });

  it('never calls visual for a generate-mode scene and commits only review-sourced versions', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    let calls = 0;
    const visual = async () => {
      calls++;
      return { verdict: { sceneId: 's1', pass: true, issues: [], fixes: [] }, refused: [], dropped: [] };
    };
    await reviewScene(t.ctx, 's1', [frame], { visual });
    expect(calls).toBe(1);
    const versions = await t.films.versions(t.filmId);
    expect(versions.filter((v) => v.version > 1).every((v) => v.source === 'review')).toBe(true);

    const gen = await filmWithCaption({ mode: 'generate' });
    let genCalls = 0;
    await reviewScene(gen.ctx, 's1', [frame], {
      visual: async () => {
        genCalls++;
        return { verdict: { sceneId: 's1', pass: true, issues: [], fixes: [] }, refused: [], dropped: [] };
      },
    });
    expect(genCalls).toBe(0);
  });

  it('keeps the deterministic fix when the visual check fails and reports it', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    const visual = async () => {
      throw new ReviewError('spark-failed', 'x');
    };
    await reviewScene(t.ctx, 's1', [frame], { visual });
    const evs = await events(t);
    expect(evs.some((e) => e.type === 'error' && e.where === 'review.visual')).toBe(true);
    expect(await captionY(t)).not.toBe(800);
  });

  it('estimates an animated product from its first keyframe instead of writing a non-numeric position', async () => {
    const t = await filmWithCaption({ captionBox: { x: 700, y: 400, w: 520, h: 120 } });
    const comp = (await t.films.get(t.filmId)).composition as AepCompositionJson;
    await t.films.commit(
      t.filmId,
      setKeyframes(comp, 's1:product', 'y', [
        [0, 140],
        [2, 160],
      ]),
      'user',
    );
    const res = await reviewScene(t.ctx, 's1', [], {});
    expect(res.unresolved.filter((f) => f.kind === 'text-over-product')).toHaveLength(0);
    const evs = await events(t);
    expect(evs.some((e) => e.type === 'error' && e.where === 'review.fix')).toBe(false);
  });

  it('undoes visual fixes that increase the error count', async () => {
    const t = await filmWithCaption({ captionBox: { x: 200, y: 300, w: 300, h: 80 } });
    const before = (await t.films.get(t.filmId)).version;
    const comp0 = JSON.stringify((await t.films.get(t.filmId)).composition);
    const visual = async () => ({
      verdict: {
        sceneId: 's1',
        pass: false,
        issues: [{ image: 1, atSec: 0.8, kind: 'text-over-product', where: 's1:caption', evidence: 'the caption sits on the product photo' }],
        fixes: [{ tool: 'setTransform', args: { layerId: 's1:caption', x: 700, y: 400 } }],
      },
      refused: [],
      dropped: [],
    });
    const res = await reviewScene(t.ctx, 's1', [frame], { visual });
    expect(res.reverted).toBe(true);
    expect(res.applied).toBe(0);
    expect(JSON.stringify((await t.films.get(t.filmId)).composition)).toBe(comp0);
    expect((await t.films.get(t.filmId)).version).toBe(before);
    const evs = await events(t);
    expect(evs.some((e) => e.type === 'review.fix' && String(e.note).includes('reverted: fixes increased findings (0 -> 1)'))).toBe(true);
  });

  it('keeps a visual fix on the same tool and layer as a deterministic fix when the args differ', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    const visual = async () => ({
      verdict: {
        sceneId: 's1',
        pass: false,
        issues: [{ image: 1, atSec: 0.8, kind: 'off-centre', where: 's1:caption', evidence: 'the caption is too far left' }],
        fixes: [{ tool: 'setTransform', args: { layerId: 's1:caption', x: 640 } }],
      },
      refused: [],
      dropped: [],
    });
    await reviewScene(t.ctx, 's1', [frame], { visual });
    const evs = await events(t);
    const calls = evs.filter((e) => e.type === 'tool.call' && e.name === 'setTransform' && (e.args as { x?: number }).x === 640);
    expect(calls).toHaveLength(1);
  });

  it('does not apply visual fixes when the verdict has no grounded issue', async () => {
    const t = await filmWithCaption({ captionBox: { x: 200, y: 300, w: 300, h: 80 } });
    const before = (await t.films.get(t.filmId)).version;
    const visual = async () => ({
      verdict: { sceneId: 's1', pass: true, issues: [], fixes: [{ tool: 'setTransform', args: { layerId: 's1:product', scale: 1.4 } }] },
      refused: [],
      dropped: [],
    });
    const res = await reviewScene(t.ctx, 's1', [frame], { visual });
    expect(res.applied).toBe(0);
    expect((await t.films.get(t.filmId)).version).toBe(before);
  });

  it('pairs each visual fix with the issue about its layer, and its own frame', async () => {
    const t = await filmWithCaption({ captionBox: { x: 200, y: 300, w: 300, h: 80 } });
    const early: VisualFrame = { id: 'early', atSec: 0.5, image: await png('#808080') };
    const late: VisualFrame = { id: 'late', atSec: 3, image: await png('#808080') };
    const visual = async () => ({
      verdict: {
        sceneId: 's1',
        pass: false,
        issues: [
          { image: 1, atSec: 0.5, kind: 'a', where: 's1:caption', evidence: 'caption problem early on' },
          { image: 2, atSec: 3, kind: 'b', where: 's1:product', evidence: 'product problem late on' },
        ],
        fixes: [{ tool: 'setTransform', args: { layerId: 's1:product', scale: 1.4 } }],
      },
      refused: [],
      dropped: [],
    });
    await reviewScene(t.ctx, 's1', [early, late], { visual });
    const evs = await events(t);
    const fix = evs.find((e) => e.type === 'review.fix' && e.note === 'setTransform s1:product');
    expect(fix).toMatchObject({ atSec: 3, beforeFrame: 'late' });
  });

  it('does not revert when the film changed after the visual fixes were applied', async () => {
    const t = await filmWithCaption({ captionBox: { x: 200, y: 300, w: 300, h: 80 } });
    let fixed = false;
    let readsAfterFix = 0;
    let injected = false;
    const hook = (inner: typeof t.films.mutate) =>
      (async (...args: Parameters<typeof t.films.mutate>) => {
        const r = await inner(...args);
        if (args[2] === 'review') fixed = true;
        return r;
      }) as typeof t.films.mutate;
    const films = {
      ...t.films,
      mutate: hook(t.films.mutate),
      get: (async (id: never) => {
        // the read that follows applyFixes records versionAfter; the next one is inside the regression check
        if (fixed && ++readsAfterFix === 2 && !injected) {
          injected = true;
          const comp = (await t.films.get(id)).composition as AepCompositionJson;
          await t.films.commit(id, setTransform(comp, 's1:bg', { x: 1 }), 'user');
        }
        return t.films.get(id);
      }) as typeof t.films.get,
    };
    const visual = async () => ({
      verdict: {
        sceneId: 's1',
        pass: false,
        issues: [{ image: 1, atSec: 0.8, kind: 'text-over-product', where: 's1:caption', evidence: 'the caption sits on the product photo' }],
        fixes: [{ tool: 'setTransform', args: { layerId: 's1:caption', x: 700, y: 400 } }],
      },
      refused: [],
      dropped: [],
    });
    const res = await reviewScene({ ...t.ctx, films }, 's1', [frame], { visual });
    expect(injected).toBe(true);
    expect(res.reverted).toBe(false);
    const evs = await events(t);
    expect(evs.some((e) => e.type === 'error' && String(e.message).includes('film changed during review'))).toBe(true);
  });

  it('reverts a visual fix that puts the caption back over the product, even on the same tool and layer', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    const visual = async () => ({
      verdict: { sceneId: 's1', pass: false, issues: [{ image: 1, atSec: 0.8, kind: 'text-over-product', where: 's1:caption', evidence: 'the caption sits on the product photo' }], fixes: [{ tool: 'setTransform', args: { layerId: 's1:caption', y: 907.2 } }] },
      refused: [],
      dropped: [],
    });
    const res = await reviewScene(t.ctx, 's1', [frame], { visual });
    expect(res.reverted).toBe(true);
    expect(await captionY(t)).toBe(987.4);
  });
});

describe('runReview', () => {
  it('sets reviewing before and ready after, and runs every scene', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    const results = await runReview(t.ctx, { frames: { s1: [frame] }, visual: noVisual });
    expect(results.map((r) => r.sceneId)).toEqual(['s1']);
    const evs = await events(t);
    const statuses = evs.filter((e) => e.type === 'film.status').map((e) => e.status);
    expect(statuses.slice(-2)).toEqual(['reviewing', 'ready']);
    expect((await t.films.get(t.filmId)).status).toBe('ready');
  });
});

describe('runReview retry budget', () => {
  it('lets later scenes make one attempt after a scene needed a retry', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    let comp = (await t.films.get(t.filmId)).composition as AepCompositionJson;
    comp = addScene(comp, { id: 's2', durationSec: 3, mode: 'motion', intent: 'close' });
    comp = addLayer(comp, { sceneId: 's2', role: 'bg', kind: 'shape', fill: '#111827' });
    await t.films.commit(t.filmId, comp, 'user');
    const seen: Array<number | undefined> = [];
    const visual = async (o: { maxAttempts?: number }) => {
      seen.push(o.maxAttempts);
      throw new ReviewError('spark-invalid', 'bad');
    };
    await runReview(t.ctx, { frames: { s1: [frame], s2: [frame] }, visual });
    expect(seen).toEqual([2, 1]);
  });
});

describe('runReview errors', () => {
  it('keeps the review error when restoring the status also fails', async () => {
    const t = await filmWithCaption({ captionY: 800 });
    let reads = 0;
    const films = {
      ...t.films,
      // the first read (composition check) works; the review itself then fails to read
      get: (async (id: never) => {
        if (++reads > 2) throw new Error('read failed');
        return t.films.get(id);
      }) as typeof t.films.get,
      update: (async (id: never, patch: { status?: string }) => {
        if (patch.status === 'ready') throw new Error('disk full');
        return t.films.update(id, patch as never);
      }) as typeof t.films.update,
    };
    await expect(runReview({ ...t.ctx, films }, { frames: { s1: [frame] }, visual: noVisual })).rejects.toThrow('read failed');
  });
});

describe('missing composition', () => {
  it('runReview rejects with a ReviewError before touching the status', async () => {
    const t = await makeTestFilm();
    await expect(runReview(t.ctx, { frames: {} })).rejects.toBeInstanceOf(ReviewError);
  });
});

describe('apply', () => {
  it('records fixes as review edits and stops at the first failure', async () => {
    const t = await filmWithCaption();
    const ok = await applyFixes(t.ctx, [{ tool: 'setTransform', args: { layerId: 's1:caption', y: 907.2 } }]);
    expect(ok.applied).toHaveLength(1);
    const versions = await t.films.versions(t.filmId);
    expect(versions.at(-1)!.source).toBe('review');
    const comp = (await t.films.get(t.filmId)).composition as AepCompositionJson;
    expect(JSON.stringify(comp)).toContain('907.2');

    const version = (await t.films.get(t.filmId)).version;
    const bad = await applyFixes(t.ctx, [
      { tool: 'setTransform', args: { layerId: 's1:nope', y: 1 } },
      { tool: 'setTransform', args: { layerId: 's1:caption', y: 1 } },
    ]);
    expect(bad.applied).toEqual([]);
    expect(bad.failed!.error).toBeTruthy();
    expect((await t.films.get(t.filmId)).version).toBe(version);
  });

  it('withCommitSource only changes the source argument', async () => {
    const t = await filmWithCaption();
    const calls: unknown[][] = [];
    const spied = {
      ...t.films,
      commit: async (...a: unknown[]) => (calls.push(a), t.films.commit(...(a as [never, never, never, never]))),
    } as typeof t.films;
    const wrapped = withCommitSource(spied, 'review');
    expect(wrapped.get).toBe(spied.get);
    expect(wrapped.versions).toBe(spied.versions);
    const comp = (await t.films.get(t.filmId)).composition!;
    await wrapped.commit(t.filmId, comp, 'director', 'note');
    expect(calls[0]![2]).toBe('review');
    expect(calls[0]![3]).toBe('note');
  });
});
