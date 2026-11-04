export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}
const prices: Record<string, { input: number; output: number }> = {
  'muse-spark-1.3-contributor': { input: 0.1, output: 0.2 },
  'muse-spark-1.3': { input: 1.25, output: 4.25 },
  // Baseten hackathon credits cover it and no per-token price is published for the key, so it is recorded at $0 until one is known.
  'meta-models/muse-spark-open-1026': { input: 0, output: 0 },
};
export function isPriced(model: string): boolean {
  return model.startsWith('muse-glimmer') || !!prices[model];
}
export function editCostUsd(model: string, usage?: TokenUsage): number {
  if (!usage) return 0;
  const p = prices[model];
  if (!p) return 0;
  const input = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? 0,
    output = usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? 0;
  return (input * p.input + output * p.output) / 1_000_000;
}
