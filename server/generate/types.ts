// Owned by S7a. Wire types for the generate routes; the web mirror is web/src/panels/generate-types.ts.
import { z } from 'zod';

export const modeRequestSchema = z.object({ mode: z.enum(['motion', 'generate', '3d']) });
export type ModeRequest = z.infer<typeof modeRequestSchema>;

export const proposalSchema = z.object({
  token: z.string(),
  sceneId: z.string(),
  attempt: z.number(),
  model: z.enum(['fast-h3', 'fast-h3-omni']),
  durationSec: z.number(),
  withSound: z.boolean(),
  estCredits: z.literal(25),
  reason: z.string(),
  balance: z.number().optional(),
  expiresAt: z.string(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const modeResponseSchema = z.object({ mode: z.enum(['motion', 'generate']), proposal: proposalSchema.optional() });
export type ModeResponse = z.infer<typeof modeResponseSchema>;

export type GenerateErrorCode =
  | 'bad_token' | 'token_expired' | 'token_used' | 'generate_cap' | 'rate_limited' | 'insufficient_credits'
  | 'not_generate_scene' | 'runner_unavailable' | 'public_url_invalid' | 'pro_plan_required';
