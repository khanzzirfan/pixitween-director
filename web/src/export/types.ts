// Owned by S8a.
import type { PlayerHandle } from '../player/Player';

export type ExportErrorCode = 'no-canvas' | 'unsupported' | 'tab-hidden' | 'aborted' | 'recorder-error' | 'timeout';

export class ExportError extends Error {
  readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ExportError';
    this.code = code;
  }
}

export interface ExportDriver {
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getTime(): number;
}

export type ExportPlayerHandle = Pick<PlayerHandle, 'getCanvas' | 'play' | 'pause' | 'seek' | 'getTime'>;
