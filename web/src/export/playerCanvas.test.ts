import { describe, expect, it, vi } from 'vitest';
import { getExportCanvas, isDrawingBufferPreserved, playerToDriver } from './playerCanvas';
import { ExportError, type ExportPlayerHandle } from './types';

const handle = (canvas: unknown = {}): ExportPlayerHandle => ({ getCanvas: () => canvas as never, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getTime: vi.fn(() => 1.5) });

describe('getExportCanvas', () => {
  it('throws no-canvas for a missing handle or canvas', () => {
    for (const h of [null, handle(null)]) {
      try {
        getExportCanvas(h);
        throw new Error('did not throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ExportError);
        expect((e as ExportError).code).toBe('no-canvas');
      }
    }
  });
  it('returns the canvas', () => {
    const c = { id: 'c' };
    expect(getExportCanvas(handle(c))).toBe(c);
  });
});

describe('isDrawingBufferPreserved', () => {
  const canvasWith = (attrs: unknown) => ({ getContext: (t: string) => (t === 'webgl2' ? { getContextAttributes: () => attrs } : null) }) as unknown as HTMLCanvasElement;
  it('reads the context attributes', () => {
    expect(isDrawingBufferPreserved(canvasWith({ preserveDrawingBuffer: true }))).toBe(true);
    expect(isDrawingBufferPreserved(canvasWith({ preserveDrawingBuffer: false }))).toBe(false);
  });
  it('is null without a context', () => expect(isDrawingBufferPreserved({ getContext: () => null } as unknown as HTMLCanvasElement)).toBeNull());
});

it('playerToDriver delegates', () => {
  const h = handle();
  const d = playerToDriver(h);
  d.play();
  d.pause();
  d.seek(2);
  expect(d.getTime()).toBe(1.5);
  expect(h.play).toHaveBeenCalledOnce();
  expect(h.pause).toHaveBeenCalledOnce();
  expect(h.seek).toHaveBeenCalledWith(2);
});

it('ExportError carries its code', () => {
  const e = new ExportError('no-canvas', 'x');
  expect(e.name).toBe('ExportError');
  expect(e.code).toBe('no-canvas');
});
