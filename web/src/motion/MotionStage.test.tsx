import { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AepCompositionJson } from '@shared/aep/composition';
import { MotionStage } from './MotionStage';
import type { MotionHandle } from '@engine/react/MotionPlayer';

const h = vi.hoisted(() => {
  const inst = {
    load: vi.fn(async (_doc: unknown) => ({ ok: true, warnings: [] }) as const),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn((s: number) => {
      inst.time = s;
    }),
    getTime: vi.fn(() => inst.time),
    getDuration: vi.fn(() => 5),
    getCanvas: vi.fn(() => null),
    whenReady: vi.fn(async () => true),
    layerErrors: vi.fn(() => []),
    destroy: vi.fn(),
    time: 0,
  };
  return { inst };
});

vi.mock('@engine/runtime/MotionRuntime', () => ({ MotionRuntime: { create: vi.fn(() => h.inst) } }));

const comp = {
  version: '1.9.0',
  id: 'c',
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 150,
  layers: [],
  assets: {},
} as unknown as AepCompositionJson;

describe('MotionStage', () => {
  it('loads a doc matching the composition size and proxies seek/getTime', async () => {
    const ref = createRef<MotionHandle>();
    render(<MotionStage ref={ref} composition={comp} />);
    await waitFor(() => expect(h.inst.load).toHaveBeenCalled());
    const doc = h.inst.load.mock.calls[0][0] as { width: number; height: number };
    expect(doc.width).toBe(1280);
    expect(doc.height).toBe(720);
    ref.current!.seek(2);
    expect(h.inst.seek).toHaveBeenCalledWith(2);
    expect(ref.current!.getTime()).toBe(2);
  });

  it('shows an error instead of throwing when conversion fails', () => {
    const bad = { ...comp, fps: 0, width: -1 } as AepCompositionJson;
    render(<MotionStage composition={bad} />);
    expect(screen.getByTestId('motion-stage-error')).toBeInTheDocument();
  });
});
