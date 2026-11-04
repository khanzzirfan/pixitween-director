// Owned by S8a.
import type { PlayerHandle } from '../player/Player';

export type ExportErrorCode = 'no-canvas' | 'unsupported' | 'tab-hidden' | 'aborted' | 'recorder-error' | 'timeout' | 'not-ready';

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
  /** The motion blur at `sec`, when the film has any: an exact export draws the frame `samples` times across the shutter and averages them. */
  blurAt?(sec: number): { shutter: number; samples: number } | null;
}

export type ExportPlayerHandle = Pick<PlayerHandle, 'getCanvas' | 'play' | 'pause' | 'seek' | 'getTime'> & Partial<Pick<PlayerHandle, 'whenReady' | 'blurAt'>>;

/** How long an export waits for the 3D product to draw before it gives up, in seconds. */
export const EXPORT_READY_WAIT_SEC = 20;
export const NOT_READY_MESSAGE = 'The 3D product did not finish drawing, so nothing was exported. Wait a moment and try again.';
