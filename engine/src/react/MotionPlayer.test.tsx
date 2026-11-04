import { act, fireEvent, render } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MotionDocInput } from '../schema';
import { MotionPlayer, type MotionHandle } from './MotionPlayer';

const { createMock, instances } = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>;
    load: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    seek: ReturnType<typeof vi.fn>;
    getTime: ReturnType<typeof vi.fn>;
    getDuration: ReturnType<typeof vi.fn>;
    getCanvas: ReturnType<typeof vi.fn>;
    whenReady: ReturnType<typeof vi.fn>;
    renderFrame: ReturnType<typeof vi.fn>;
    layerErrors: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  }> = [];

  const createMock = vi.fn((options: Record<string, unknown>) => {
    let time = 0;
    const instance = {
      options,
      load: vi.fn(async () => ({ ok: true, warnings: [] }) as const),
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn((sec: number) => {
        time = sec;
      }),
      getTime: vi.fn(() => time),
      getDuration: vi.fn(() => 10),
      getCanvas: vi.fn(() => document.createElement('canvas')),
      whenReady: vi.fn(async () => true),
      renderFrame: vi.fn(async () => document.createElement('canvas')),
      layerErrors: vi.fn(() => [] as Array<{ layerId: string; message: string }>),
      destroy: vi.fn(),
      destroyed: false,
    };
    instance.destroy.mockImplementation(() => {
      instance.destroyed = true;
    });
    instances.push(instance);
    return instance;
  });

  return { createMock, instances };
});

vi.mock('../runtime/MotionRuntime', () => ({
  MotionRuntime: { create: createMock },
}));

function flushInstances() {
  instances.length = 0;
}

const doc: MotionDocInput = {
  version: 1,
  width: 100,
  height: 100,
  fps: 30,
  duration: 2,
  layers: [{ id: 'a', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 }],
};

describe('MotionPlayer', () => {
  it('destroys every runtime it created, even across StrictMode double-invoke', async () => {
    flushInstances();
    const { unmount } = render(
      <StrictMode>
        <MotionPlayer doc={doc} />
      </StrictMode>,
    );
    await act(async () => {});

    expect(instances.length).toBeGreaterThanOrEqual(1);
    unmount();

    for (const instance of instances) {
      expect(instance.destroyed).toBe(true);
    }
  });

  it('calls load once with a new doc, and onDocErrors on an invalid doc', async () => {
    flushInstances();
    const onDocErrors = vi.fn();
    const { rerender } = render(<MotionPlayer doc={doc} onDocErrors={onDocErrors} />);
    await act(async () => {});

    const instance = instances[instances.length - 1];
    expect(instance.load).toHaveBeenCalledTimes(1);
    expect(instance.load).toHaveBeenCalledWith(doc);

    const nextDoc: MotionDocInput = { ...doc, duration: 4 };
    rerender(<MotionPlayer doc={nextDoc} onDocErrors={onDocErrors} />);
    await act(async () => {});
    expect(instance.load).toHaveBeenCalledTimes(2);
    expect(instance.load).toHaveBeenLastCalledWith(nextDoc);

    instance.load.mockResolvedValueOnce({ ok: false, errors: [{ path: 'width', message: 'bad' }] });
    const badDoc: MotionDocInput = { ...doc, duration: 5 };
    rerender(<MotionPlayer doc={badDoc} onDocErrors={onDocErrors} />);
    await act(async () => {});

    expect(onDocErrors).toHaveBeenCalledWith([{ path: 'width', message: 'bad' }]);
  });

  it('frame-forward at 30 fps seeks to time + 1/30, and handle.seek(2) calls runtime.seek(2)', async () => {
    flushInstances();
    const ref = createRef<MotionHandle>();
    const { getByLabelText } = render(<MotionPlayer ref={ref} doc={doc} />);
    await act(async () => {});

    const instance = instances[instances.length - 1];

    fireEvent.click(getByLabelText('Next frame'));
    expect(instance.seek).toHaveBeenCalledWith(1 / 30);

    act(() => {
      ref.current?.seek(2);
    });
    expect(instance.seek).toHaveBeenCalledWith(2);
  });
});
