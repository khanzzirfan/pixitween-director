import type { ToolResult } from '@shared/tools';
export type ArtErrorCode =
  | 'no-object'
  | 'alpha-size-mismatch'
  | 'bad-image'
  | 'too-large'
  | 'order-invalid'
  | 'unknown-scene'
  | 'lint'
  | 'generate-mode'
  | 'plate-exists'
  | 'no-plate';
export class ArtError extends Error {
  constructor(
    readonly code: ArtErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArtError';
  }
}
export function toolError(e: unknown): ToolResult {
  return { ok: false, error: e instanceof ArtError ? e.message : 'internal error' };
}
