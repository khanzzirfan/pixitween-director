import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { ChatResponse } from '@shared/ports';
import { makeTestFilm } from '../test-utils/film';
import { makeFakeMeta } from '../meta/fakes';
import { MetaApiError } from '../meta/http';
import { priceSpark } from '../pricing';
import { buildScenePrompt, buildStoryboardMessages, parseTargetSeconds } from './prompts/director';
import { normaliseStoryboard, planStoryboard, SPARK_STORYBOARD_SCHEMA, SPARK_STORYBOARD_SCHEMA_3D, StoryboardError } from './storyboard';

const raw = (n = 4) => ({
  title: '  Morning Ritual  ',
  palette: ['red', '#F5E6D3', '#111827'],
  scenes: Array.from({ length: n }, (_, i) => ({
    id: `scene-${i + 1}`,
    durationSec: i === 0 ? 1 : 8,
    intent: `Scene ${i + 1}`,
    shotType: i === 0 ? 'hero' : 'lifestyle',
    camera: 'static',
    layersWanted: ['product', 'bg', 'bg'],
    text: i === 0 ? ' Slow mornings ' : ' ',
    mode: i > 0 ? 'generate' : 'motion',
    modeReason: 'Still works.',
  })),
});
const response = (content: string, usage?: ChatResponse['usage']): ChatResponse => ({
  content,
  toolCalls: [],
  ms: 5,
  model: 'muse-spark-1.3-contributor',
  ...(usage ? { usage } : {}),
});

it('normalises scenes, palette, ids, duration, text and generate cap', () => {
  const plan = normaliseStoryboard(raw(), { aspect: '9:16' });
  expect(plan).toMatchObject({ title: 'Morning Ritual', aspect: '9:16', palette: ['#f5e6d3', '#111827'] });
  expect(plan.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
  expect(plan.scenes.map((s) => s.mode)).toEqual(['motion', 'generate', 'generate', 'motion']);
  expect(plan.scenes[1]!.estCredits).toBe(25);
  expect(plan.scenes[3]!.modeReason).toContain('(demoted: at most 2 generate scenes)');
  expect(plan.scenes[0]!.durationSec).toBe(2);
  expect(plan.scenes[0]!.text).toBe('Slow mornings');
  expect(plan.scenes.slice(1).every((s) => s.text === undefined)).toBe(true);
  expect(plan.scenes.every((s) => s.layersWanted.includes('bg'))).toBe(true);
  expect(plan.scenes.reduce((sum, s) => sum + s.durationSec, 0)).toBe(plan.durationSec);
});

it('scales long storyboards under 30 seconds and reports malformed scenes', () => {
  const long = raw(6);
  for (const scene of long.scenes) scene.durationSec = 8;
  const plan = normaliseStoryboard(long, { aspect: '16:9' });
  expect(plan.durationSec).toBeLessThanOrEqual(30);
  expect(plan.scenes.every((s) => s.durationSec >= 2)).toBe(true);
  expect(() => normaliseStoryboard({ title: 'x' }, { aspect: '16:9' })).toThrow(new StoryboardError('scenes must be an array'));
});

it('sends strict schema and repairs invalid JSON once while accounting for tokens', async () => {
  const t = await makeTestFilm();
  const answer = JSON.stringify(raw(3));
  const meta = makeFakeMeta({
    sparkScript: [
      response('{oops', { promptTokens: 1000, completionTokens: 1200 }),
      response(answer, { promptTokens: 500, completionTokens: 600 }),
    ],
  });
  const film = await t.films.get(t.filmId);
  const plan = await planStoryboard({
    ctx: { ...t.ctx, meta },
    film,
    model: 'muse-spark-1.3-contributor',
    productJpeg: Buffer.from('photo'),
  });
  expect(plan.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  expect(meta.calls).toHaveLength(2);
  const first = meta.calls[0]!.args as [{ response_format: { json_schema: { strict: boolean } }; messages: Array<{ content: unknown }> }];
  expect(first[0].response_format.json_schema.strict).toBe(true);
  expect(JSON.stringify(first[0].messages)).toContain('data:image/jpeg;base64,');
  const second = meta.calls[1]!.args as [{ messages: Array<{ content: unknown }> }];
  expect(second[0].messages.at(-1)?.content).toMatch(/^Your JSON was invalid:/);
  expect(t.ledger.total(t.filmId)).toBeCloseTo(priceSpark('muse-spark-1.3-contributor', 1500, 1800), 10);
});

it('has the expected prompt constraints and optional image part', () => {
  expect(parseTargetSeconds('make it 5 seconds')).toBe(8);
  expect(parseTargetSeconds('45 seconds')).toBe(30);
  expect(parseTargetSeconds('no length specified')).toBeUndefined();
  const messages = buildStoryboardMessages({ brief: 'mug at sunrise', aspect: '1:1' });
  expect(messages[0]!.content).toContain('choose "motion" by default');
  expect(messages[0]!.content).toContain('Example 1');
  expect(messages[0]!.content).toContain('Example 2');
  expect(messages[0]!.content).toContain('Never invent claims');
  expect(Array.isArray(messages[1]!.content)).toBe(false);
  const withPhoto = buildStoryboardMessages({ brief: 'mug', aspect: '16:9', productJpeg: Buffer.from('x') });
  expect(JSON.stringify(withPhoto)).toContain('data:image/jpeg;base64,');
  expect(SPARK_STORYBOARD_SCHEMA.additionalProperties).toBe(false);
  const build = buildScenePrompt({
    canvas: { width: 1920, height: 1080, aspect: '16:9' },
    scene: normaliseStoryboard(raw(3), { aspect: '16:9' }).scenes[0]!,
    palette: ['#111827'],
    product: { assetId: 'p', width: 200, height: 300 },
    toolNames: ['addLayer'],
  });
  expect(build).toContain('prop:"opacity"');
  expect(build).not.toContain('generatePlate');
});

describe('photo request fallback', () => {
  it('retries without a photo after a 400 size error', async () => {
    const t = await makeTestFilm();
    const film = await t.films.get(t.filmId);
    let calls = 0;
    const meta = makeFakeMeta();
    meta.spark.chat = async (req) => {
      calls++;
      if (calls === 1) throw new MetaApiError(400, 'unsupported image size');
      expect(JSON.stringify(req.messages)).not.toContain('image_url');
      return response(JSON.stringify(raw(3)));
    };
    const emitted: string[] = [];
    const ctx = {
      ...t.ctx,
      meta,
      emit: (event: { type: string; message?: string }) => {
        if (event.type === 'error') emitted.push(event.message ?? '');
      },
    };
    const plan = await planStoryboard({ ctx, film, model: 'muse-spark-1.3-contributor', productJpeg: Buffer.from('photo') });
    expect(plan.scenes).toHaveLength(3);
    expect(calls).toBe(2);
    expect(emitted).toContain('retrying without the product photo');
  });
});

describe('the third mode (S13b)', () => {
  const three = (productShape?: string) => ({
    title: 'Can',
    palette: ['#111827'],
    ...(productShape ? { productShape } : {}),
    scenes: [
      { id: 'a', durationSec: 4, intent: 'The can turns in the light', shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: '3d', modeReason: 'The product itself turns.' },
      { id: 'b', durationSec: 4, intent: 'A morning table', shotType: 'lifestyle', camera: 'pan', layersWanted: ['bg'], mode: 'motion', modeReason: 'A still is enough.' },
    ],
  });

  it("keeps mode '3d' with PRODUCT_3D on and a can", () => {
    const sb = normaliseStoryboard(three('can'), { aspect: '16:9', product3d: true });
    expect(sb.scenes[0]).toMatchObject({ mode: '3d', modeReason: 'The product itself turns.' });
    expect(sb.productShape).toBe('can');
  });

  it("makes the same scene 'motion' with PRODUCT_3D off, and says so at the end of the reason", () => {
    const sb = normaliseStoryboard(three('can'), { aspect: '16:9', product3d: false });
    expect(sb.scenes[0]!.mode).toBe('motion');
    expect(sb.scenes[0]!.modeReason.endsWith('(3d off)')).toBe(true);
    expect(sb.productShape).toBeUndefined();
  });

  it("keeps '3d' for productShape 'other': it is extruded", () => {
    expect(normaliseStoryboard(three('other'), { aspect: '16:9', product3d: true }).scenes[0]!.mode).toBe('3d');
  });

  it("demotes '3d' when the shape is missing or not one we know, with its own reason", () => {
    const missing = normaliseStoryboard(three(), { aspect: '16:9', product3d: true });
    expect(missing.scenes[0]).toMatchObject({ mode: 'motion' });
    expect(missing.scenes[0]!.modeReason.endsWith('(no product shape)')).toBe(true);
    expect(normaliseStoryboard(three('sphere'), { aspect: '16:9', product3d: true }).scenes[0]!.mode).toBe('motion');
  });

  it('reads the PRODUCT_3D switch when the caller does not say', () => {
    const saved = process.env.PRODUCT_3D;
    try {
      process.env.PRODUCT_3D = 'true';
      expect(normaliseStoryboard(three('bottle'), { aspect: '16:9' }).scenes[0]!.mode).toBe('3d');
      delete process.env.PRODUCT_3D;
      expect(normaliseStoryboard(three('bottle'), { aspect: '16:9' }).scenes[0]!.mode).toBe('motion');
    } finally {
      if (saved === undefined) delete process.env.PRODUCT_3D;
      else process.env.PRODUCT_3D = saved;
    }
  });

  it('does not count a 3d scene against the generate limit', () => {
    const sb = normaliseStoryboard(three('can'), { aspect: '16:9', product3d: true });
    expect(sb.scenes.filter((s) => s.mode === 'generate')).toHaveLength(0);
    expect(sb.scenes[0]).not.toHaveProperty('estCredits');
  });
});

describe('the three-way prompt rule (S13b)', () => {
  const system = (product3d: boolean) => buildStoryboardMessages({ brief: 'A can of sparkling water', aspect: '16:9', product3d })[0]!.content as string;

  it("tells the model when to use 3d, with PRODUCT_3D on", () => {
    const s = system(true);
    expect(s).toContain('Use 3d when the shot is about the product itself turning');
    expect(s).toContain('productShape');
    expect(s).toContain('"mode":"3d"');
    expect(s).toContain('3. mode: pick the cheapest technique that can tell the shot');
  });

  it("does not mention 3d at all with PRODUCT_3D off, and keeps the old rule", () => {
    const s = system(false);
    expect(s).not.toMatch(/3d/i);
    expect(s).not.toContain('productShape');
    expect(s).toContain('3. mode: choose "motion" by default.');
  });

  it('reads the switch for the prompt and for the schema when the caller does not say', () => {
    const saved = process.env.PRODUCT_3D;
    try {
      process.env.PRODUCT_3D = '1';
      expect(buildStoryboardMessages({ brief: 'x', aspect: '16:9' })[0]!.content).toContain('Use 3d when');
      delete process.env.PRODUCT_3D;
      expect(buildStoryboardMessages({ brief: 'x', aspect: '16:9' })[0]!.content).not.toMatch(/3d/i);
    } finally {
      if (saved === undefined) delete process.env.PRODUCT_3D;
      else process.env.PRODUCT_3D = saved;
    }
  });

  it('the strict schema with the third mode lists productShape as required and 3d as a mode', () => {
    expect(SPARK_STORYBOARD_SCHEMA_3D.required).toContain('productShape');
    expect(SPARK_STORYBOARD_SCHEMA_3D.properties.scenes.items.properties.mode.enum).toContain('3d');
    expect(SPARK_STORYBOARD_SCHEMA.properties.scenes.items.properties.mode.enum).not.toContain('3d');
  });

  const scene = (mode: 'motion' | '3d') => ({ ...normaliseStoryboard(raw(3), { aspect: '16:9' }).scenes[0]!, mode });
  const prompt = (mode: 'motion' | '3d', toolNames: string[]) =>
    buildScenePrompt({ canvas: { width: 1920, height: 1080, aspect: '16:9' }, scene: scene(mode), palette: ['#111111', '#ffffff'], product: { assetId: 'ast_x', width: 10, height: 10 }, toolNames });
  const art = ['generatePlate', 'placeProduct', 'placeProduct3D'];

  it("tells the builder of a 3d scene to call placeProduct3D after placeProduct, and not to animate the product", () => {
    const p = prompt('3d', art);
    expect(p).toContain('placeProduct3D({sceneId:"s1"})');
    expect(p.indexOf('placeProduct({')).toBeLessThan(p.indexOf('placeProduct3D('));
    expect(p).not.toContain('s1:product", prop:"scale"');
    expect(p.trimEnd()).toContain('setCamera');
  });

  it('keeps the motion recipe for a motion scene and for a 3d scene when the tool is not there', () => {
    expect(prompt('motion', art)).not.toContain('placeProduct3D');
    expect(prompt('3d', ['generatePlate', 'placeProduct'])).not.toContain('placeProduct3D');
  });
});
