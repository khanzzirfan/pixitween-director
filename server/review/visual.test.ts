import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeFakeMeta } from '../meta/fakes';
import { makeTestFilm } from '../test-utils/film';
import { MetaApiError } from '../meta/http';
import {
  ALLOWED_FIX_TOOLS,
  REVIEW_CALL_USD,
  ReviewError,
  VISUAL_SCHEMA,
  VisualParseError,
  buildVisualPrompt,
  filterFixes,
  parseVisualVerdict,
  sparkReviewer,
  visualReview,
} from './visual';
import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync('fixtures/seed/spark-vision-image-response.json', 'utf8')) as {
  choices: Array<{ message: { content: string } }>;
};
const seedContent = seed.choices[0]!.message.content;

const fakeTool = (name: string, shape: Record<string, z.ZodTypeAny>) => ({ name, params: z.object(shape) });
const TOOLS = [
  fakeTool('setTransform', { layerId: z.string(), x: z.number().optional(), y: z.number().optional(), scale: z.number().optional() }),
  fakeTool('replacePlate', { sceneId: z.string() }),
  fakeTool('generatePlate', { sceneId: z.string() }),
];

describe('visual prompt', () => {
  it('names each frame time and says when there are no automatic findings', () => {
    const p = buildVisualPrompt({ sceneId: 's1', frameTimes: [0.8, 2, 3.2], findings: [], layerSummary: [], tools: TOOLS });
    expect(p).toContain('Image 1 = 0.8 s, Image 2 = 2 s, Image 3 = 3.2 s');
    expect(p).toContain('Automatic checks already found: none');
  });
  it('puts one finding evidence on its own line', () => {
    const p = buildVisualPrompt({
      sceneId: 's1',
      frameTimes: [1],
      findings: ['caption covers the product'],
      layerSummary: [],
      tools: TOOLS,
    });
    expect(p.split('\n')).toContain('- caption covers the product');
  });
  it('lists only allowed tools, with their fields', () => {
    const p = buildVisualPrompt({ sceneId: 's1', frameTimes: [1], findings: [], layerSummary: [], tools: TOOLS });
    expect(p).toContain('- setTransform { layerId: string, x?: number, y?: number, scale?: number }');
    expect(p).not.toContain('replacePlate {');
    expect(p).not.toContain('generatePlate {');
  });
  it('scopes layers to the scene and stays short for a six-layer scene', () => {
    const layers = Array.from({ length: 6 }, (_, i) => `- s1:layer-${i} (text)`);
    const p = buildVisualPrompt({ sceneId: 's1', frameTimes: [1], findings: [], layerSummary: layers, tools: TOOLS });
    expect(p).toContain('Layers in this scene (ids start with "s1:")');
    expect(p.length).toBeLessThan(6000);
  });
  it('exports the schema and the allowlist', () => {
    expect(VISUAL_SCHEMA.required).toEqual(['sceneId', 'pass', 'issues', 'fixes']);
    expect(ALLOWED_FIX_TOOLS).toHaveLength(7);
  });
});

describe('parseVisualVerdict', () => {
  it('keeps the seed verdict issues against one frame at 1.25 s', () => {
    const { verdict, dropped } = parseVisualVerdict(seedContent, { sceneId: 's1', frameTimes: [1.25] });
    expect(verdict.issues.map((i) => i.kind)).toEqual(['text-over-product', 'low-contrast']);
    expect(verdict.issues.every((i) => i.image === 1 && i.atSec === 1.25)).toBe(true);
    expect(verdict.pass).toBe(false);
    expect(verdict.fixes).toEqual([]);
    expect(dropped).toEqual([]);
  });
  it('drops seed issues with no frame reference when there are three frames', () => {
    const { verdict, dropped } = parseVisualVerdict(seedContent, { sceneId: 's1', frameTimes: [0.8, 2, 3.2] });
    expect(verdict.issues).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(['missing image/atSec', 'missing image/atSec']);
  });
  it('checks image number, time and evidence length', () => {
    const issue = (over: object) => ({
      image: 1,
      atSec: 0.8,
      kind: 'text-over-product',
      evidence: 'caption text sits across the middle of the mug body',
      ...over,
    });
    const frames = [0.8, 2, 3.2];
    const good = parseVisualVerdict({ sceneId: 's1', pass: true, issues: [issue({})], fixes: [] }, { sceneId: 's1', frameTimes: frames });
    expect(good.verdict.issues).toHaveLength(1);
    expect(
      parseVisualVerdict({ sceneId: 's1', pass: true, issues: [issue({ atSec: 1.0 })], fixes: [] }, { sceneId: 's1', frameTimes: frames })
        .dropped[0]!.reason,
    ).toBe('time mismatch');
    expect(
      parseVisualVerdict({ sceneId: 's1', pass: true, issues: [issue({ image: 4 })], fixes: [] }, { sceneId: 's1', frameTimes: frames })
        .dropped[0]!.reason,
    ).toBe('image out of range');
    expect(
      parseVisualVerdict(
        { sceneId: 's1', pass: true, issues: [issue({ evidence: 'too short' })], fixes: [] },
        { sceneId: 's1', frameTimes: frames },
      ).dropped[0]!.reason,
    ).toBe('evidence too short');
  });
  it('recomputes pass from the kept issues', () => {
    const frames = [1];
    const claimsPass = {
      sceneId: 's1',
      pass: true,
      issues: [{ image: 1, atSec: 1, kind: 'x', evidence: 'a real visible problem here' }],
      fixes: [],
    };
    expect(parseVisualVerdict(claimsPass, { sceneId: 's1', frameTimes: frames }).verdict.pass).toBe(false);
    const claimsFail = { sceneId: 's1', pass: false, issues: [], fixes: [] };
    expect(parseVisualVerdict(claimsFail, { sceneId: 's1', frameTimes: frames }).verdict.pass).toBe(true);
  });
  it('parses fenced and plain JSON, and rejects non-JSON', () => {
    const body = { sceneId: 's1', pass: true, issues: [], fixes: [] };
    expect(parseVisualVerdict('```json\n' + JSON.stringify(body) + '\n```', { sceneId: 's1', frameTimes: [1] }).verdict.pass).toBe(true);
    expect(parseVisualVerdict(JSON.stringify(body), { sceneId: 's1', frameTimes: [1] }).verdict.pass).toBe(true);
    expect(() => parseVisualVerdict('not json', { sceneId: 's1', frameTimes: [1] })).toThrow(VisualParseError);
  });
});

describe('filterFixes', () => {
  const layerIds = ['s1:caption', 's1:product'];
  const fix = (tool: string, args: unknown) => ({ tool, args }) as { tool: string; args: Record<string, unknown> };
  it('accepts a setTransform on a layer in this scene', () => {
    expect(filterFixes([fix('setTransform', { layerId: 's1:caption', y: 900 })], { sceneId: 's1', layerIds }).accepted).toHaveLength(1);
  });
  it('refuses tools outside the allowlist', () => {
    for (const tool of ['replacePlate', 'generatePlate', 'addScene', 'removeLayer', 'removeScene']) {
      const r = filterFixes([fix(tool, { sceneId: 's1' })], { sceneId: 's1', layerIds });
      expect(r.refused[0]!.reason).toBe('tool not allowed');
    }
  });
  it('refuses other scenes and unknown layers', () => {
    expect(filterFixes([fix('setTransform', { layerId: 's2:caption', y: 1 })], { sceneId: 's1', layerIds }).refused[0]!.reason).toBe(
      'other scene',
    );
    expect(filterFixes([fix('setSceneDuration', { sceneId: 's2', sec: 3 })], { sceneId: 's1', layerIds }).refused[0]!.reason).toBe(
      'other scene',
    );
    expect(filterFixes([fix('setTransform', { layerId: 's1:ghost', y: 1 })], { sceneId: 's1', layerIds }).refused[0]!.reason).toBe(
      'unknown layer',
    );
  });
  it('refuses string args and caps accepted fixes at six', () => {
    expect(filterFixes([fix('setTransform', 'y=1')], { sceneId: 's1', layerIds }).refused[0]!.reason).toBe('args must be an object');
    const eight = Array.from({ length: 8 }, (_, i) => fix('setTransform', { layerId: 's1:caption', y: i }));
    const r = filterFixes(eight, { sceneId: 's1', layerIds });
    expect(r.accepted).toHaveLength(6);
    expect(r.refused.map((x) => x.reason)).toEqual(['too many', 'too many']);
  });
});

async function frame(color: string, w = 64) {
  return sharp({ create: { width: w, height: 64, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}
function spyLedger(t: Awaited<ReturnType<typeof makeTestFilm>>) {
  const costs: number[] = [];
  const ctx = { ...t.ctx, ledger: { ...t.ledger, add: (_f: string, _m: string, _u: string, usd: number) => void costs.push(usd) } };
  return { ctx, costs };
}
const reviewInput = async (ctx: Awaited<ReturnType<typeof makeTestFilm>>['ctx'], over = {}) => ({
  ctx,
  sceneId: 's1',
  frames: [{ image: await frame('#808080'), atSec: 0.8 }],
  findings: [],
  layerSummary: ['- s1:caption (text)'],
  layerIds: ['s1:caption'],
  tools: TOOLS,
  ...over,
});

describe('visualReview', () => {
  it('makes one call, returns a grounded verdict and records the cost', async () => {
    const t = await makeTestFilm();
    const calls: Array<{ n: number; schema: object }> = [];
    const reviewer = async (images: Buffer[], _p: string, schema: object) => {
      calls.push({ n: images.length, schema });
      return { sceneId: 's1', pass: true, issues: [], fixes: [] };
    };
    const { ctx, costs } = spyLedger(t);
    const out = await visualReview(await reviewInput(ctx, { reviewer }));
    expect(out.verdict.pass).toBe(true);
    expect(calls).toEqual([{ n: 1, schema: VISUAL_SCHEMA }]);
    expect(costs).toEqual([REVIEW_CALL_USD]);
  });
  it('retries once after an invalid answer and charges each answer', async () => {
    const t = await makeTestFilm();
    const prompts: string[] = [];
    const answers = ['not json', { sceneId: 's1', pass: true, issues: [], fixes: [] }];
    const reviewer = async (_i: Buffer[], p: string) => {
      prompts.push(p);
      return answers.shift();
    };
    const { ctx, costs } = spyLedger(t);
    const out = await visualReview(await reviewInput(ctx, { reviewer }));
    expect(out.verdict.pass).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('Your previous answer was not valid JSON');
    expect(costs.reduce((a, b) => a + b, 0)).toBeCloseTo(0.004);
  });
  it('rejects with spark-invalid after two invalid answers', async () => {
    const t = await makeTestFilm();
    const reviewer = async () => 'not json';
    await expect(visualReview(await reviewInput(t.ctx, { reviewer }))).rejects.toMatchObject({ code: 'spark-invalid' });
  });
  it('makes a single call when maxAttempts is 1', async () => {
    const t = await makeTestFilm();
    let calls = 0;
    const reviewer = async () => {
      calls++;
      return 'not json';
    };
    await expect(visualReview(await reviewInput(t.ctx, { reviewer, maxAttempts: 1 }))).rejects.toMatchObject({ code: 'spark-invalid' });
    expect(calls).toBe(1);
  });
  it('turns a reviewer failure into spark-failed after one call', async () => {
    const t = await makeTestFilm();
    let n = 0;
    const reviewer = async () => {
      n++;
      throw new MetaApiError(500, 'upstream');
    };
    await expect(visualReview(await reviewInput(t.ctx, { reviewer }))).rejects.toMatchObject({ code: 'spark-failed' });
    expect(n).toBe(1);
  });
  it('sends frames resized to 1280 px wide', async () => {
    const t = await makeTestFilm();
    let sent: Buffer[] = [];
    const reviewer = async (images: Buffer[]) => {
      sent = images;
      return { sceneId: 's1', pass: true, issues: [], fixes: [] };
    };
    await visualReview(await reviewInput(t.ctx, { reviewer, frames: [{ image: await frame('#808080', 2000), atSec: 0.8 }] }));
    expect((await sharp(sent[0]!).metadata()).width).toBe(1280);
  });
  it('uses pickReviewer with local false by default and skips the cost for local', async () => {
    const t = await makeTestFilm();
    const { ctx, costs } = spyLedger(t);
    const seen: boolean[] = [];
    const pickReviewer = (o: { local: boolean }) => {
      seen.push(o.local);
      return async () => ({ sceneId: 's1', pass: true, issues: [], fixes: [] });
    };
    await visualReview(await reviewInput(ctx, { pickReviewer }));
    const afterSpark = costs.length;
    await visualReview(await reviewInput(ctx, { pickReviewer, local: true }));
    expect(seen).toEqual([false, true]);
    expect(afterSpark).toBe(1);
    expect(costs).toHaveLength(1);
  });
  it('rejects with no-frames and sends nothing', async () => {
    const t = await makeTestFilm();
    let called = false;
    const reviewer = async () => {
      called = true;
      return {};
    };
    await expect(visualReview(await reviewInput(t.ctx, { reviewer, frames: [] }))).rejects.toMatchObject({ code: 'no-frames' });
    expect(called).toBe(false);
  });
  it('moves a fix on another scene into refused', async () => {
    const t = await makeTestFilm();
    const reviewer = async () => ({
      sceneId: 's1',
      pass: false,
      issues: [],
      fixes: [{ tool: 'setTransform', args: { layerId: 's2:caption', y: 1 } }],
    });
    const out = await visualReview(await reviewInput(t.ctx, { reviewer }));
    expect(out.verdict.fixes).toEqual([]);
    expect(out.refused[0]!.reason).toBe('other scene');
  });
  it('local review without a local model fails clearly', () => {
    expect(() => sparkReviewer(makeFakeMeta(), { local: true })).toThrow(ReviewError);
  });
});
