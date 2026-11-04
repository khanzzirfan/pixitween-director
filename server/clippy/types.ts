import { z } from 'zod';

export const CLIPPY_ESTIMATED_CREDITS = 25;
export const FAST_H3_MIN_SEC = 5.2;
export const MAX_CLIP_SEC = 10; // team rule: no clip over 10 s
export const FAST_H3_PROMPT_MAX = 800;
export const OMNI_PROMPT_MAX = 8000;
export const OMNI_SECONDS = [5.875, 8, 10.125, 12.25, 14.375] as const;

const https = z.string().url().refine((u) => u.startsWith('https://'), { message: 'must be an https URL' });
const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/);

const fastH3 = z.object({
  model: z.literal('fast-h3'),
  prompt: z.string().min(1).max(FAST_H3_PROMPT_MAX),
  sourceImageUrl: https,
  durationSec: z.number().min(FAST_H3_MIN_SEC).max(14.375),
  aspect: z.enum(['16:9', '9:16', '1:1']),
  idempotencyKey: idempotencyKey.optional(),
  imageUrls: z.array(https).max(1).optional(),
});

const omni = z.object({
  model: z.literal('fast-h3-omni'),
  prompt: z.string().min(1).max(OMNI_PROMPT_MAX),
  imageUrls: z.array(https).min(1).max(9),
  durationSec: z.number().refine((n) => OMNI_SECONDS.some((s) => Math.abs(s - n) < 1e-6), { message: `durationSec must be one of ${OMNI_SECONDS.join(', ')}` }),
  aspect: z.enum(['16:9', '1:1', '9:16', '4:3']),
  idempotencyKey: idempotencyKey.optional(),
});

export const animateImageArgsSchema = z.discriminatedUnion('model', [fastH3, omni]);
export type AnimateImageArgs = z.infer<typeof animateImageArgsSchema>;

export const submitResultSchema = z.object({ jobId: z.string(), status: z.string(), estimatedCredits: z.number() });
export type SubmitResult = z.infer<typeof submitResultSchema>;

export const statusResultSchema = z
  .object({
    jobId: z.string(),
    status: z.enum(['queued', 'planning', 'rendering', 'done', 'failed', 'cancelled']),
    progress: z.number().optional(),
    resultUrl: z.string().nullable(),
    resultUrlExpiresAt: z.string().nullable().optional(),
    error: z.unknown().optional(),
    creditsCharged: z.number().optional(),
  })
  .passthrough();
export type StatusResult = z.infer<typeof statusResultSchema>;

export const balanceResultSchema = z.object({ currentBalance: z.number() }).passthrough();
export type BalanceResult = z.infer<typeof balanceResultSchema>;
