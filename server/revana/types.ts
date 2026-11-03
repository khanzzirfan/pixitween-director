/** Shared Revana generation types. Seedance and every other video model use this one object. */

export type RevanaStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface RevanaGenerationError {
  code: string;
  message: string;
  retryable: boolean;
  reason?: string;
}

export interface RevanaOutput {
  urls?: string[];
  width?: number;
  height?: number;
  duration_s?: number;
  has_audio?: boolean;
}

export interface RevanaGeneration {
  id: string;
  object?: 'generation';
  model: string;
  status: RevanaStatus;
  message?: string;
  quoted_usd?: number;
  reserved_usd?: number;
  cost_usd?: number | null;
  output?: RevanaOutput | null;
  error?: RevanaGenerationError | null;
  created_at?: string;
  completed_at?: string | null;
}

export interface RevanaQuote {
  quoted_usd: number;
  reserved_usd: number;
  estimated_seconds?: number;
  available_usd?: number;
  enough_credit?: boolean;
}

export interface RevanaBalance {
  available_usd: number;
  held_usd: number;
  balance_usd: number;
  spent_usd: number;
}

export interface RevanaUpload {
  url: string;
  upload_url: string;
  upload_headers: Record<string, string>;
  expires_at?: string;
}

export interface RevanaSubmitOptions {
  /** Most this job may cost. Routes above it are skipped. Set it from a quote. */
  maxCostUsd?: number;
  maxWaitS?: number;
  /** Resend this after a timeout, 429 or 5xx. Use a new one after a generation has failed. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}
