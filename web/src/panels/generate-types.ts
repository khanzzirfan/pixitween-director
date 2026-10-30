// Mirrors server/generate/types.ts (plain interfaces, so web does not import server code at runtime).
export interface Proposal {
  token: string;
  sceneId: string;
  attempt: number;
  model: 'fast-h3' | 'fast-h3-omni';
  durationSec: number;
  withSound: boolean;
  estCredits: 25;
  reason: string;
  balance?: number;
  expiresAt: string;
}
export interface ModeResponse {
  mode: 'motion' | 'generate' | '3d';
  proposal?: Proposal;
}
export type GenerateErrorCode =
  | 'bad_token' | 'token_expired' | 'token_used' | 'generate_cap' | 'rate_limited' | 'insufficient_credits'
  | 'not_generate_scene' | 'runner_unavailable' | 'public_url_invalid' | 'pro_plan_required';
