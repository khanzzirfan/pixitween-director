export type GlimmerErrorCode = 'unreachable' | 'http' | 'tool-parse' | 'invalid-json' | 'timeout' | 'model-missing';

export class GlimmerError extends Error {
  constructor(readonly code: GlimmerErrorCode, readonly status?: number, message?: string) {
    super(message ?? `Glimmer ${code}${status !== undefined ? ` (${status})` : ''}`);
    this.name = 'GlimmerError';
  }
}
