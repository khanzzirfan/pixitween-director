import type { RevanaGeneration } from './types';

export class RevanaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfterS?: number;
  constructor(message: string, status: number, code: string, requestId?: string, retryAfterS?: number) {
    super(message);
    this.name = 'RevanaApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterS = retryAfterS;
  }
  /** Safe to send again with the same Idempotency-Key. A 4xx other than 429 is the request's fault. */
  get retryable(): boolean {
    return this.status === 429 || this.status === 503 || this.status >= 500;
  }
}

export class RevanaGenerationFailedError extends Error {
  readonly generation: RevanaGeneration;
  constructor(generation: RevanaGeneration) {
    const code = generation.error?.code ?? 'unknown';
    super(`Revana generation ${generation.id} failed: ${code}`);
    this.name = 'RevanaGenerationFailedError';
    this.generation = generation;
  }
  get retryable(): boolean {
    return this.generation.error?.retryable === true;
  }
}

export class RevanaTimeoutError extends Error {
  readonly generationId: string;
  readonly waitedMs: number;
  constructor(generationId: string, waitedMs: number) {
    super(`Revana generation ${generationId} was still running after ${Math.round(waitedMs / 1000)}s`);
    this.name = 'RevanaTimeoutError';
    this.generationId = generationId;
    this.waitedMs = waitedMs;
  }
}

export class RevanaConfigError extends Error {
  constructor(message = 'REVANA_API_KEY is not set') {
    super(message);
    this.name = 'RevanaConfigError';
  }
}
