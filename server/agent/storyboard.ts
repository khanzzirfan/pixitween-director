import type { Buffer } from 'node:buffer';
import type { Aspect, FilmState } from '@shared/composition';
import type { Storyboard } from '@shared/storyboard';
import { MAX_GENERATE_SCENES, PRODUCT_SHAPES, storyboardSchema } from '@shared/storyboard';
import type { ChatMessage } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { buildStoryboardMessages } from './prompts/director';
import { loadEnv } from '../env';
import { MetaApiError } from '../meta/http';
import { priceSpark } from '../pricing';

export const STUB_OWNER = 'S3b' as const;

const sceneFields = ['id', 'durationSec', 'intent', 'shotType', 'camera', 'layersWanted', 'text', 'mode', 'modeReason'];
const sceneProperties = {
  id: { type: 'string' },
  durationSec: { type: 'number' },
  intent: { type: 'string' },
  shotType: { type: 'string', enum: ['hero', 'detail', 'lifestyle', 'reveal', 'closer'] },
  camera: { type: 'string', enum: ['static', 'dolly-in', 'pan', 'orbit', 'parallax'] },
  layersWanted: { type: 'array', items: { type: 'string', enum: ['bg', 'product', 'subject', 'headline', 'caption'] } },
  text: { type: 'string' },
  mode: { type: 'string', enum: ['motion', 'generate'] },
  modeReason: { type: 'string' },
};
export const SPARK_STORYBOARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'palette', 'scenes'],
  properties: {
    title: { type: 'string' },
    palette: { type: 'array', items: { type: 'string' } },
    scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: sceneFields, properties: sceneProperties } },
  },
} as const;

/** The schema with the third mode and the product's shape, for a film that may have 3D scenes. */
export const SPARK_STORYBOARD_SCHEMA_3D = {
  ...SPARK_STORYBOARD_SCHEMA,
  required: ['title', 'palette', 'scenes', 'productShape'],
  properties: {
    ...SPARK_STORYBOARD_SCHEMA.properties,
    productShape: { type: 'string', enum: [...PRODUCT_SHAPES] },
    scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: sceneFields, properties: { ...sceneProperties, mode: { type: 'string', enum: ['motion', 'generate', '3d'] } } } },
  },
} as const;

export class StoryboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryboardError';
  }
}

/** `product3d` says whether 3D scenes are allowed; it defaults to the PRODUCT_3D switch. */
export function normaliseStoryboard(raw: unknown, o: { aspect: Aspect; title?: string; product3d?: boolean }): Storyboard {
  if (!raw || typeof raw !== 'object') throw new StoryboardError('storyboard must be an object');
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.scenes)) throw new StoryboardError('scenes must be an array');
  const title = (o.title?.trim() || (typeof value.title === 'string' ? value.title.trim() : '')).slice(0, 80);
  const palette = (Array.isArray(value.palette) ? value.palette : [])
    .filter((x): x is string => typeof x === 'string' && /^#[\da-f]{6}$/i.test(x))
    .map((x) => x.toLowerCase())
    .slice(0, 6);
  const colors = palette.length ? palette : ['#111827', '#f59e0b'];
  const allow3d = o.product3d ?? loadEnv().PRODUCT_3D;
  const shape = typeof value.productShape === 'string' && (PRODUCT_SHAPES as readonly string[]).includes(value.productShape) ? (value.productShape as (typeof PRODUCT_SHAPES)[number]) : undefined;
  let generated = 0;
  const scenes = value.scenes.map((item, i) => {
    const s = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const shotType = s.shotType as string;
    let mode = s.mode === 'generate' ? 'generate' : s.mode === '3d' ? '3d' : 'motion';
    let modeReason = typeof s.modeReason === 'string' ? s.modeReason : '';
    // 3d needs the switch on and a known product shape ('other' is fine: it is extruded)
    if (mode === '3d' && (!allow3d || !shape)) {
      mode = 'motion';
      modeReason = `${modeReason} ${allow3d ? '(no product shape)' : '(3d off)'}`.trim().slice(0, 240);
    }
    if (mode === 'generate' && generated >= MAX_GENERATE_SCENES) {
      mode = 'motion';
      modeReason = `${modeReason} (demoted: at most 2 generate scenes)`.slice(0, 240);
    } else if (mode === 'generate') generated++;
    const wanted = Array.isArray(s.layersWanted)
      ? [...new Set(s.layersWanted.filter((x): x is string => ['bg', 'product', 'subject', 'headline', 'caption'].includes(String(x))))]
      : [];
    if (!wanted.includes('bg')) wanted.unshift('bg');
    if (shotType !== 'lifestyle' && !wanted.includes('product')) wanted.push('product');
    const n = Number(s.durationSec);
    const durationSec = Math.round(Math.min(8, Math.max(2, Number.isFinite(n) ? n : 4)) * 10) / 10;
    const text = typeof s.text === 'string' ? s.text.trim().slice(0, 120) : '';
    return {
      id: `s${i + 1}`,
      durationSec,
      intent: typeof s.intent === 'string' ? s.intent.trim() : '',
      shotType,
      camera: s.camera,
      layersWanted: wanted,
      ...(text ? { text } : {}),
      mode,
      modeReason,
      ...(mode === 'generate' ? { estCredits: 25 } : {}),
    } as unknown as Storyboard['scenes'][number];
  });
  let total = scenes.reduce((n, s) => n + s.durationSec, 0);
  if (total > 30) {
    const reducible = scenes.reduce((n, s) => n + Math.max(0, s.durationSec - 2), 0);
    const excess = total - 30;
    for (const s of scenes) s.durationSec = Math.round(Math.max(2, s.durationSec - (excess * (s.durationSec - 2)) / reducible) * 10) / 10;
    total = scenes.reduce((n, s) => n + s.durationSec, 0);
    while (total > 30) {
      const longest = scenes.reduce((a, b) => (a.durationSec >= b.durationSec ? a : b));
      if (longest.durationSec <= 2) break;
      longest.durationSec = Math.round((longest.durationSec - 0.1) * 10) / 10;
      total = scenes.reduce((n, s) => n + s.durationSec, 0);
    }
  }
  if (!scenes.length) throw new StoryboardError('scenes must contain at least one scene');
  const candidate = { title, aspect: o.aspect, durationSec: total, palette: colors, scenes, ...(shape && allow3d ? { productShape: shape } : {}) };
  const parsed = storyboardSchema.safeParse(candidate);
  if (!parsed.success)
    throw new StoryboardError(`${parsed.error.issues[0]?.path.join('.') || 'storyboard'}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export async function planStoryboard(o: { ctx: ToolCtx; film: FilmState; model: string; productJpeg?: Buffer }): Promise<Storyboard> {
  const three = loadEnv().PRODUCT_3D;
  const messages = buildStoryboardMessages({
    brief: o.film.brief.text,
    title: o.film.title,
    aspect: o.film.aspect,
    productJpeg: o.productJpeg,
    product3d: three,
  });
  const call = async (msgs: ChatMessage[]) => {
    const start = Date.now();
    const response = await o.ctx.meta.spark.chat({
      model: o.model,
      messages: msgs,
      response_format: { type: 'json_schema', json_schema: { name: 'storyboard', strict: true, schema: three ? SPARK_STORYBOARD_SCHEMA_3D : SPARK_STORYBOARD_SCHEMA } },
    });
    if (response.usage)
      o.ctx.ledger.add(
        o.film.id,
        o.model,
        `${response.usage.promptTokens} in / ${response.usage.completionTokens} out tokens`,
        priceSpark(o.model, response.usage.promptTokens, response.usage.completionTokens),
      );
    o.ctx.emit({ type: 'agent.turn', backend: 'spark', ms: response.ms ?? Date.now() - start, calls: 0 });
    return response.content ?? '';
  };
  const parse = (content: string) => normaliseStoryboard(JSON.parse(content), { aspect: o.film.aspect, title: o.film.title });
  let content: string;
  try {
    content = await call(messages);
  } catch (e) {
    if (!(e instanceof MetaApiError) || e.status !== 400 || !o.productJpeg) throw e;
    o.ctx.emit({ type: 'error', where: 'storyboard', message: 'retrying without the product photo' });
    const withoutPhoto = buildStoryboardMessages({ brief: o.film.brief.text, title: o.film.title, aspect: o.film.aspect, product3d: three });
    content = await call(withoutPhoto);
    try {
      return parse(content);
    } catch (first) {
      const repair: ChatMessage[] = [
        ...withoutPhoto,
        { role: 'assistant', content },
        {
          role: 'user',
          content: `Your JSON was invalid: ${first instanceof Error ? first.message : String(first)}. Return the corrected JSON only.`,
        },
      ];
      try {
        return parse(await call(repair));
      } catch (error) {
        throw new StoryboardError(error instanceof Error ? error.message : String(error));
      }
    }
  }
  try {
    return parse(content);
  } catch (first) {
    const repair: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content },
      {
        role: 'user',
        content: `Your JSON was invalid: ${first instanceof Error ? first.message : String(first)}. Return the corrected JSON only.`,
      },
    ];
    try {
      return parse(await call(repair));
    } catch (e) {
      throw new StoryboardError(e instanceof Error ? e.message : String(e));
    }
  }
}
