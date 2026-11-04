import { createRef, forwardRef, useImperativeHandle } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AepCompositionJson } from '@shared/aep';

const m = vi.hoisted(() => ({ play: vi.fn(), pause: vi.fn(), seek: vi.fn(), time: 0 }));

vi.mock('../motion/MotionStage', async () => {
  const React = await import('react');
  return {
    MotionStage: forwardRef(function MotionStage(_p: unknown, ref: React.Ref<unknown>) {
      useImperativeHandle(ref, () => ({
        play: m.play,
        pause: m.pause,
        seek: m.seek,
        getTime: () => m.time,
        getDuration: () => 5,
        getCanvas: () => null,
        whenReady: () => Promise.resolve(true),
      }));
      return <div data-testid="motion-stage" />;
    }),
  };
});

import Player, { type PlayerHandle } from './Player';

const comp = { version: '1.9.0', id: 'c', width: 1920, height: 1080, fps: 30, durationInFrames: 150, layers: [], assets: {} } as AepCompositionJson;

afterEach(() => {
  vi.unstubAllEnvs();
  Object.values(m).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockClear());
});

describe('Player with VITE_ENGINE=motion', () => {
  it('renders MotionStage and the handle reaches it', () => {
    vi.stubEnv('VITE_ENGINE', 'motion');
    const ref = createRef<PlayerHandle>();
    render(<Player ref={ref} composition={comp} />);
    expect(screen.getByTestId('motion-stage')).toBeTruthy();
    ref.current!.seek(3);
    expect(m.seek).toHaveBeenCalledWith(3);
    ref.current!.play();
    ref.current!.pause();
    expect(m.play).toHaveBeenCalled();
    expect(m.pause).toHaveBeenCalled();
  });

  it('mounts MotionStage when VITE_ENGINE is unset (default)', () => {
    vi.stubEnv('VITE_ENGINE', '');
    render(<Player composition={comp} />);
    expect(screen.getByTestId('motion-stage')).toBeTruthy();
  });

  it('controls drive the motion handle', () => {
    vi.stubEnv('VITE_ENGINE', 'motion');
    render(<Player composition={comp} />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(m.play).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(m.pause).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Seek'), { target: { value: '2' } });
    expect(m.seek).toHaveBeenCalledWith(2);
  });
});
