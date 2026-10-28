import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { MetaClients } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { resizeFit } from '../media/image';

export const STUB_OWNER = 'S5b' as const;

/** Spark vision calls are billed per request; the price is recorded once per answer, local vision is free. */
export const VISION_MODEL = 'muse-spark-1.3-contributor';
export const REVIEW_CALL_USD = 0.002;
/** Frames are resized so the longest side is at most this many pixels before they go to Spark. */
export const REVIEW_MAX_SIDE = 1280;
/** A reported time must sit within this many seconds of the frame it names. */
export const TIME_TOLERANCE_SEC = 0.05;
export const MIN_EVIDENCE_CHARS = 12;
export const MAX_FIXES_PER_SCENE = 6;

/** The only tools a visual review may propose. Each one is small, free and stays inside its scene. */
export const ALLOWED_FIX_TOOLS = [
  'setTransform',
  'setText',
  'setSceneDuration',
  'setKeyframes',
  'nudgeLayer',
  'scaleLayer',
  'restyleText',
] as const;

export class ReviewError extends Error {
  constructor(
    readonly code: 'no-frames' | 'spark-failed' | 'spark-invalid' | 'local-vision-unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}
export class VisualParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisualParseError';
  }
}

export const VISUAL_SCHEMA = {
  type: 'object',
  required: ['sceneId', 'pass', 'issues', 'fixes'],
  properties: {
    sceneId: { type: 'string' },
    pass: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['image', 'atSec', 'kind', 'evidence'],
        properties: {
          image: { type: 'integer' },
          atSec: { type: 'number' },
          kind: { type: 'string' },
          where: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    fixes: {
      type: 'array',
      items: { type: 'object', required: ['tool', 'args'], properties: { tool: { type: 'string' }, args: { type: 'object' } } },
    },
  },
};

export interface VisualIssue {
  image: number;
  atSec: number;
  kind: string;
  where?: string;
  evidence: string;
}
export interface ProposedFix {
  tool: string;
  args: Record<string, unknown>;
}
export interface VisualVerdict {
  sceneId: string;
  pass: boolean;
  issues: VisualIssue[];
  fixes: ProposedFix[];
}
export type Reviewer = (images: Buffer[], prompt: string, schema: object) => Promise<unknown>;

const zodTypeName = (schema: z.ZodTypeAny): string => {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodEffects || s instanceof z.ZodNullable) {
    s = s instanceof z.ZodEffects ? s.innerType() : s.unwrap();
  }
  if (s instanceof z.ZodString) return 'string';
  if (s instanceof z.ZodNumber) return 'number';
  if (s instanceof z.ZodBoolean) return 'boolean';
  return 'value';
};

/** One line per allowed tool, built from its zod params, e.g. `- setTransform { layerId: string, x?: number }`. */
export function describeTool(tool: { name: string; params: z.ZodTypeAny }): string {
  let schema: z.ZodTypeAny = tool.params;
  while (schema instanceof z.ZodEffects) schema = schema.innerType();
  const shape = schema instanceof z.ZodObject ? (schema.shape as Record<string, z.ZodTypeAny>) : {};
  const fields = Object.entries(shape).map(([key, field]) => `${key}${field.isOptional() ? '?' : ''}: ${zodTypeName(field)}`);
  return `- ${tool.name} { ${fields.join(', ')} }`;
}

export function buildVisualPrompt(o: {
  sceneId: string;
  frameTimes: number[];
  findings: string[];
  layerSummary: string[];
  tools: Array<{ name: string; params: z.ZodTypeAny }>;
}): string {
  const images = o.frameTimes.map((t, i) => `Image ${i + 1} = ${t} s`).join(', ');
  const found = o.findings.length ? o.findings.map((f) => `- ${f}`).join('\n') : 'none';
  const allowed = o.tools.filter((t) => (ALLOWED_FIX_TOOLS as readonly string[]).includes(t.name));
  return [
    `You are reviewing scene "${o.sceneId}" of a short product film. Judge only what is visible in the images.`,
    `The images are frames from this scene: ${images}.`,
    `Automatic checks already found: ${o.findings.length ? '' : 'none'}`,
    ...(o.findings.length ? [found] : []),
    'Report only clear visual faults: text that is hard to read, text covering the product, a cut-off subject, or a broken frame.',
    `Layers in this scene (ids start with "${o.sceneId}:"):`,
    ...o.layerSummary,
    'HOW TO FIX: propose at most a few fixes, using only these tools and only layers in this scene:',
    ...allowed.map(describeTool),
    'Reply with only a JSON object: {"sceneId": string, "pass": boolean, "issues": [{"image": number, "atSec": number, "kind": string, "where": string, "evidence": string}], "fixes": [{"tool": string, "args": object}]}.',
    'Every issue must name the image number and the second it appears at. Evidence is one sentence describing what you see.',
  ].join('\n');
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    throw new VisualParseError('reply is not JSON');
  }
}

export interface DroppedIssue {
  reason: string;
  issue?: unknown;
}

/** Keeps only issues tied to a real frame and time; recomputes `pass` from what is kept. */
export function parseVisualVerdict(
  raw: unknown,
  o: { sceneId: string; frameTimes: number[] },
): { verdict: VisualVerdict; dropped: DroppedIssue[] } {
  const body = parseJson(raw);
  if (!body || typeof body !== 'object') throw new VisualParseError('reply is not an object');
  const input = body as { issues?: unknown; fixes?: unknown };
  const dropped: DroppedIssue[] = [];
  const issues: VisualIssue[] = [];
  for (const item of Array.isArray(input.issues) ? input.issues : []) {
    const raw = (item ?? {}) as Partial<VisualIssue>;
    let image = raw.image;
    let atSec = raw.atSec;
    if (image === undefined && atSec === undefined && o.frameTimes.length === 1) {
      image = 1;
      atSec = o.frameTimes[0];
    }
    if (typeof image !== 'number' || typeof atSec !== 'number') {
      dropped.push({ reason: 'missing image/atSec', issue: item });
      continue;
    }
    if (!Number.isInteger(image) || image < 1 || image > o.frameTimes.length) {
      dropped.push({ reason: 'image out of range', issue: item });
      continue;
    }
    if (Math.abs(atSec - o.frameTimes[image - 1]!) > TIME_TOLERANCE_SEC) {
      dropped.push({ reason: 'time mismatch', issue: item });
      continue;
    }
    const evidence = typeof raw.evidence === 'string' ? raw.evidence.trim() : '';
    if (evidence.length < MIN_EVIDENCE_CHARS) {
      dropped.push({ reason: 'evidence too short', issue: item });
      continue;
    }
    issues.push({
      image,
      atSec,
      kind: typeof raw.kind === 'string' && raw.kind ? raw.kind : 'visual-issue',
      ...(typeof raw.where === 'string' ? { where: raw.where } : {}),
      evidence,
    });
  }
  const fixes = Array.isArray(input.fixes)
    ? input.fixes.filter((f): f is ProposedFix => !!f && typeof f === 'object' && typeof (f as ProposedFix).tool === 'string')
    : [];
  return { verdict: { sceneId: o.sceneId, pass: issues.length === 0, issues, fixes }, dropped };
}

export interface RefusedFix {
  fix: ProposedFix;
  reason: string;
}

/** Keeps only fixes that name an allowed tool, a layer in this scene, and an object of args. */
export function filterFixes(
  fixes: ProposedFix[],
  o: { sceneId: string; layerIds: string[] },
): { accepted: ProposedFix[]; refused: RefusedFix[] } {
  const accepted: ProposedFix[] = [];
  const refused: RefusedFix[] = [];
  for (const fix of fixes) {
    if (!(ALLOWED_FIX_TOOLS as readonly string[]).includes(fix.tool)) {
      refused.push({ fix, reason: 'tool not allowed' });
      continue;
    }
    if (!fix.args || typeof fix.args !== 'object' || Array.isArray(fix.args)) {
      refused.push({ fix, reason: 'args must be an object' });
      continue;
    }
    const args = fix.args as { layerId?: unknown; sceneId?: unknown };
    if (fix.tool === 'setSceneDuration' && (args.sceneId ?? o.sceneId) !== o.sceneId) {
      refused.push({ fix, reason: 'other scene' });
      continue;
    }
    if (typeof args.layerId === 'string') {
      const scope = args.layerId.includes(':') ? args.layerId.split(':')[0] : o.sceneId;
      if (scope !== o.sceneId) {
        refused.push({ fix, reason: 'other scene' });
        continue;
      }
      if (!o.layerIds.includes(args.layerId)) {
        refused.push({ fix, reason: 'unknown layer' });
        continue;
      }
    }
    if (accepted.length >= MAX_FIXES_PER_SCENE) {
      refused.push({ fix, reason: 'too many' });
      continue;
    }
    accepted.push(fix);
  }
  return { accepted, refused };
}

export function sparkReviewer(meta: MetaClients, o: { local: boolean }): Reviewer {
  if (o.local) throw new ReviewError('local-vision-unavailable', 'no local vision model is configured');
  return (images, prompt, schema) => meta.spark.reviewImages(images, prompt, schema);
}

export interface VisualFrame {
  /** The stored frame asset id, when the frame was captured for this film. */
  id?: string;
  image: Buffer;
  atSec: number;
}

/** One grounded Spark review of a scene. A malformed answer gets one retry; a failed call is not retried. */
export async function visualReview(o: {
  ctx: ToolCtx;
  sceneId: string;
  frames: VisualFrame[];
  findings: string[];
  layerSummary: string[];
  layerIds: string[];
  tools: Array<{ name: string; params: z.ZodTypeAny }>;
  local?: boolean;
  /** Calls allowed for this scene: 2 means one retry after a malformed answer. */
  maxAttempts?: number;
  reviewer?: Reviewer;
  pickReviewer?: (o: { local: boolean }) => Reviewer;
}): Promise<{ verdict: VisualVerdict; refused: RefusedFix[]; dropped: DroppedIssue[] }> {
  if (!o.frames.length) throw new ReviewError('no-frames', 'no frames to review');
  const local = !!o.local;
  const reviewer = o.reviewer ?? (o.pickReviewer ?? ((opts) => sparkReviewer(o.ctx.meta, opts)))({ local });
  const frameTimes = o.frames.map((f) => f.atSec);
  const images = await Promise.all(o.frames.map((f) => resizeFit(f.image, REVIEW_MAX_SIDE, 'jpeg')));
  const basePrompt = buildVisualPrompt({
    sceneId: o.sceneId,
    frameTimes,
    findings: o.findings,
    layerSummary: o.layerSummary,
    tools: o.tools,
  });
  let prompt = basePrompt;
  for (let attempt = 0; attempt < (o.maxAttempts ?? 2); attempt++) {
    let answer: unknown;
    try {
      answer = await reviewer(images, prompt, VISUAL_SCHEMA);
    } catch (e) {
      throw new ReviewError('spark-failed', e instanceof Error ? e.message : String(e));
    }
    if (!local) o.ctx.ledger.add(o.ctx.filmId, VISION_MODEL, `vision review, ${images.length} images`, REVIEW_CALL_USD);
    try {
      const { verdict, dropped } = parseVisualVerdict(answer, { sceneId: o.sceneId, frameTimes });
      const { accepted, refused } = filterFixes(verdict.fixes, { sceneId: o.sceneId, layerIds: o.layerIds });
      return { verdict: { ...verdict, fixes: accepted }, refused, dropped };
    } catch (e) {
      if (!(e instanceof VisualParseError)) throw e;
      prompt = `Your previous answer was not valid JSON (${e.message}). Reply with only the JSON object.\n\n${basePrompt}`;
    }
  }
  throw new ReviewError('spark-invalid', 'Spark did not return a valid review after a retry');
}
