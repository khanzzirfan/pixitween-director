// Owned by S12a. The crew contract: jobs, lanes, the style bible, storyboard ops and inbox items (design.md section 4).
import { z } from 'zod';
import { sceneSchema } from './storyboard';

export const CREW_ENGINES = ['native', 'langgraph'] as const;
export type CrewEngine = (typeof CREW_ENGINES)[number];

export const LANES = ['showrunner', 'builder', 'critic', 'continuity', 'producer', 'listener', 'local'] as const;
export const laneSchema = z.enum(LANES);
export type Lane = z.infer<typeof laneSchema>;

export const JOB_KINDS = ['build-scene', 'rebuild-scene', 'restyle-scene', 'edit', 'fix', 'take', 'critique', 'continuity', 'revert'] as const;
export const jobKindSchema = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof jobKindSchema>;

/** Kinds that change a scene's layers: at most one of them runs per scene at a time. */
export const WRITING_KINDS: readonly JobKind[] = ['build-scene', 'rebuild-scene', 'restyle-scene', 'edit', 'fix', 'revert'];

export const jobStatusSchema = z.enum(['queued', 'running', 'awaiting-frames', 'done', 'failed', 'cancelled', 'superseded']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobOriginSchema = z.enum(['user', 'showrunner', 'auto']);
export type JobOrigin = z.infer<typeof jobOriginSchema>;

export const jobSchema = z.object({
  id: z.string().min(1),
  kind: jobKindSchema,
  sceneId: z.string().optional(),
  filmId: z.string().min(1), // differs from the parent film for takes
  brief: z.string().max(600),
  reason: z.string().max(200),
  origin: jobOriginSchema,
  status: jobStatusSchema,
  worker: z.string().optional(),
  model: z.string().optional(),
  takeOf: z.string().optional(),
  takeLabel: z.enum(['A', 'B', 'C']).optional(),
  dependsOn: z.array(z.string()).optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  ms: z.number().optional(),
  costUsd: z.number(),
  version: z.number().optional(),
  summary: z.string().max(300).optional(),
  error: z.string().optional(),
  supersededBy: z.string().optional(),
});
export type Job = z.infer<typeof jobSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** The style bible names one of these stacks; the actual CSS stacks live in server/authoring/constants.ts. */
export const BIBLE_FONT_IDS = ['sans', 'serif', 'rounded', 'condensed', 'mono'] as const;
export type BibleFontId = (typeof BIBLE_FONT_IDS)[number];

export const styleBibleSchema = z.object({
  palette: z.array(hex).min(2).max(6),
  light: z.string().max(120),
  camera: z.string().max(120),
  type: z.object({ font: z.enum(BIBLE_FONT_IDS), weight: z.number().int().min(100).max(900), case: z.enum(['upper', 'title', 'sentence']) }),
  productLine: z.string().max(160),
  mood: z.string().max(80),
});
export type StyleBible = z.infer<typeof styleBibleSchema>;

const addedScene = sceneSchema.omit({ id: true }).extend({ id: sceneSchema.shape.id.optional() });

export const storyboardOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), scene: addedScene, after: z.string().nullable().optional() }), // null = first, omitted = last
  z.object({ op: z.literal('update'), sceneId: z.string(), patch: sceneSchema.omit({ id: true }).partial() }),
  z.object({ op: z.literal('remove'), sceneId: z.string() }),
  z.object({ op: z.literal('move'), sceneId: z.string(), after: z.string().nullable() }),
]);
export type StoryboardOp = z.infer<typeof storyboardOpSchema>;

export const inboxItemSchema = z.object({
  id: z.string().min(1),
  at: z.string(),
  from: z.enum(['user', 'system', 'job', 'critic', 'continuity', 'producer']),
  text: z.string().max(2000),
  selection: z.object({ sceneId: z.string().optional(), layerId: z.string().optional() }).optional(),
  jobId: z.string().optional(),
  data: z.unknown().optional(),
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

/** Lower runs first: the user's request, then fixes, then writing jobs, takes, and last the checks. */
export function JOB_PRIORITY(job: Pick<Job, 'origin' | 'kind'>): number {
  if (job.origin === 'user') return 0;
  if (job.kind === 'fix') return 1;
  if (WRITING_KINDS.includes(job.kind)) return 2;
  if (job.kind === 'take') return 3;
  return 4;
}
