import { z } from 'zod';
import { FILM_ID_RE, type FilmId } from './composition';
import { inboxItemSchema, jobSchema, laneSchema, storyboardOpSchema, styleBibleSchema } from './crew';
import { storyboardSchema } from './storyboard';

const base = { filmId: z.string().regex(FILM_ID_RE), at: z.string() };
const t = <T extends string>(type: T) => z.literal(type);

const assetRefSchema = z.object({
  id: z.string(),
  url: z.string(),
  mime: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  role: z.enum(['product-photo', 'plate', 'still', 'cutout', 'mask', 'clip', 'frame', 'audio']).optional(),
  sceneId: z.string().optional(),
  filmId: z.string().optional(),
  atSec: z.number().optional(),
  phase: z.enum(['before', 'after']).optional(),
  batch: z.string().optional(),
});

export const filmEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: t('film.status'), status: z.enum(['new', 'planning', 'building', 'reviewing', 'ready', 'failed']) }),
  z.object({ ...base, type: t('listener.transcript'), text: z.string() }),
  z.object({ ...base, type: t('director.storyboard'), storyboard: storyboardSchema }),
  z.object({
    ...base,
    type: t('agent.turn'),
    backend: z.enum(['spark', 'glimmer', 'spark-open', 'wonder']),
    ms: z.number(),
    calls: z.number(),
    reply: z.string().optional(),
  }),
  z.object({
    ...base,
    type: t('tool.call'),
    name: z.string(),
    args: z.unknown(),
    ok: z.boolean(),
    error: z.string().optional(),
    version: z.number().optional(),
  }),
  z.object({ ...base, type: t('art.asset'), asset: assetRefSchema }),
  z.object({
    ...base,
    type: t('review.finding'),
    sceneId: z.string(),
    kind: z.string(),
    atSec: z.number().optional(),
    evidence: z.string(),
    deterministic: z.boolean(),
  }),
  z.object({
    ...base,
    type: t('review.fix'),
    sceneId: z.string(),
    atSec: z.number().optional(),
    beforeFrame: z.string().optional(),
    afterFrame: z.string().optional(),
    note: z.string(),
  }),
  z.object({ ...base, type: t('generate.proposed'), sceneId: z.string(), reason: z.string(), estCredits: z.number(), token: z.string() }),
  z.object({ ...base, type: t('generate.progress'), sceneId: z.string(), status: z.string() }),
  z.object({ ...base, type: t('generate.done'), sceneId: z.string(), asset: assetRefSchema, productVisibleFrac: z.number().optional() }),
  z.object({ ...base, type: t('cost'), usd: z.number(), model: z.string(), units: z.string(), credits: z.number().optional() }),
  z.object({
    ...base,
    type: t('crew.agent'),
    lane: laneSchema,
    worker: z.string(),
    state: z.enum(['idle', 'thinking', 'working', 'waiting']),
    jobId: z.string().optional(),
    model: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({ ...base, type: t('job.update'), job: jobSchema }),
  z.object({ ...base, type: t('showrunner.heard'), inboxId: z.string(), from: inboxItemSchema.shape.from, text: z.string() }),
  z.object({ ...base, type: t('showrunner.say'), kind: z.enum(['note', 'reply', 'ask']), text: z.string(), options: z.array(z.string()).optional() }),
  z.object({
    ...base,
    type: t('storyboard.revised'),
    rev: z.number().int(),
    source: z.enum(['showrunner', 'user']),
    ops: z.array(storyboardOpSchema),
    storyboard: storyboardSchema,
  }),
  z.object({ ...base, type: t('style.bible'), bible: styleBibleSchema }),
  z.object({
    ...base,
    type: t('take.ready'),
    jobId: z.string(),
    takeOf: z.string(),
    sceneId: z.string(),
    label: z.enum(['A', 'B', 'C']),
    takeFilmId: z.string(),
    thumbAssetId: z.string().optional(),
    score: z.number().optional(),
    note: z.string().optional(),
  }),
  z.object({ ...base, type: t('capture.request'), requestId: z.string(), sceneId: z.string(), timesSec: z.array(z.number()) }),
  z.object({ ...base, type: t('budget'), spentUsd: z.number(), capUsd: z.number(), level: z.enum(['ok', 'warn', 'stop']) }),
  z.object({ ...base, type: t('error'), where: z.string(), status: z.number().optional(), message: z.string() }),
]);

export type FilmEvent = z.infer<typeof filmEventSchema>;
export type EventEnvelope = { seq: number; event: FilmEvent };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Fills `at` with the current time. A wrong field fails typecheck. */
export function makeEvent(filmId: FilmId, partial: DistributiveOmit<FilmEvent, 'filmId' | 'at'> & { at?: string }): FilmEvent {
  return { filmId, at: new Date().toISOString(), ...partial } as FilmEvent;
}
