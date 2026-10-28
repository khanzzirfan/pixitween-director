// Prices as of 27 Oct 2026 (vendor pages and S1 findings). Reasoning tokens are already inside completion_tokens.
const SPARK_PER_M: Record<string, { in: number; out: number }> = {
  'muse-spark-1.3-contributor': { in: 0.1, out: 0.2 },
  'muse-spark-1.3': { in: 1.25, out: 4.25 },
};

export function priceSpark(model: string, inTokens: number, outTokens: number): number {
  const p = SPARK_PER_M[model];
  if (!p) {
    console.warn(`pricing: unknown model '${model}', pricing at 0`);
    return 0;
  }
  return (inTokens * p.in + outTokens * p.out) / 1_000_000;
}

export const priceImage = (n: number): number => n * 0.01;
export const priceSamImages = (n: number): number => (n * 2.5) / 1000;
/** SAM video bills a 50-frame minimum per request. */
export const priceSamVideoFrames = (frames: number): number => (Math.max(frames, 50) * 0.2) / 1000;
export const priceTranscribeSeconds = (sec: number): number => (sec / 3600) * 0.18;
