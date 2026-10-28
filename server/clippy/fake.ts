import { ClippyError, type ClippyClient } from './mcp';
import { animateImageArgsSchema, type StatusResult } from './types';

export interface FakeClippyOptions {
  script?: StatusResult['status'][];
  balance?: number;
  failSubmit?: ClippyError;
  resultUrl?: string;
}

/** Scriptable offline stand-in for the Clippy client; records every call. */
export function makeFakeClippy(opts: FakeClippyOptions = {}): ClippyClient & { calls: Array<{ tool: string; args: unknown }> } {
  const calls: Array<{ tool: string; args: unknown }> = [];
  const script = opts.script ?? ['queued', 'rendering', 'rendering', 'done'];
  const keyed = new Map<string, { jobId: string; args: string }>();
  const steps = new Map<string, number>();
  const cancelled = new Set<string>();
  let n = 0;

  return {
    calls,
    async listLiveAnimateModels() {
      calls.push({ tool: 'list_live_animate_models', args: {} });
      return { models: ['fast-h3', 'fast-h3-omni'] };
    },
    async getCreditBalance() {
      calls.push({ tool: 'get_credit_balance', args: {} });
      return { currentBalance: opts.balance ?? 120 };
    },
    async animateImage(args) {
      calls.push({ tool: 'animate_image', args });
      if (opts.failSubmit) throw opts.failSubmit;
      const parsed = animateImageArgsSchema.parse(args);
      const sig = JSON.stringify(parsed);
      const key = parsed.idempotencyKey;
      if (key) {
        const prev = keyed.get(key);
        if (prev) {
          if (prev.args !== sig) throw new ClippyError('idempotency_key_reused', { tool: 'animate_image', isToolError: true });
          return { jobId: prev.jobId, status: 'rendering', estimatedCredits: 25 };
        }
      }
      const jobId = `job_${++n}`;
      if (key) keyed.set(key, { jobId, args: sig });
      return { jobId, status: 'rendering', estimatedCredits: 25 };
    },
    async getLiveAnimateStatus(jobId) {
      calls.push({ tool: 'get_live_animate_status', args: { jobId } });
      if (cancelled.has(jobId)) return { jobId, status: 'cancelled', resultUrl: null };
      const i = steps.get(jobId) ?? 0;
      steps.set(jobId, i + 1);
      const status = script[Math.min(i, script.length - 1)]!;
      return { jobId, status, resultUrl: status === 'done' ? (opts.resultUrl ?? 'https://clip.example.test/out.mp4?sig=abc') : null };
    },
    async cancelLiveAnimate(jobId) {
      calls.push({ tool: 'cancel_live_animate', args: { jobId } });
      cancelled.add(jobId);
      return { jobId, status: 'cancelled' };
    },
    async close() {},
  };
}
