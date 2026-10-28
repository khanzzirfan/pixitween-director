import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { ChatResponse } from '@shared/ports';
import { makeTestFilm } from '../test-utils/film';
import { makeFakeMeta } from '../meta/fakes';
import { MetaApiError } from '../meta/http';
import { priceSpark } from '../pricing';
import { buildScenePrompt, buildStoryboardMessages, parseTargetSeconds } from './prompts/director';
import { normaliseStoryboard, planStoryboard, SPARK_STORYBOARD_SCHEMA, StoryboardError } from './storyboard';

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
