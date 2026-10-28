import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { clampSeek, formatTime } from './format';
import Player, { type PlayerHandle } from './Player';

const h = vi.hoisted(() => ({
  ctx: { handlePlay: vi.fn(), handlePause: vi.fn(), handleSeek: vi.fn(), playerTimeRef: { current: 1.25 } },
  appProps: [] as Array<Record<string, unknown>>,
  canvas: { id: 'fake-canvas' },
}));

vi.mock('@pixi/react', async () => ({
  Application: (props: Record<string, unknown>) => {
    h.appProps.push(props);
    return <div data-testid="app">{props.children as never}</div>;
  },
  useApplication: () => ({ app: { canvas: h.canvas }, isInitialised: true }),
}));
vi.mock('reacthub-pixitweenjs', async () => {
  const React = await import('react');
  return {
    GsapPixieContext: React.createContext(h.ctx),
    GsapPixieContextProvider: ({ children }: { children: never }) => <>{children}</>,
    PixiSequenceWrapper: ({ children }: { children: never }) => <>{children}</>,
    AepComposition: () => <div data-testid="aep" />,
  };
});

const comp = { version: '1.8.0', id: 'c', width: 1920, height: 1080, fps: 30, durationInFrames: 150, layers: [], assets: {} } as AepCompositionJson;

beforeEach(() => {
  Object.values(h.ctx).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockClear());
  h.appProps.length = 0;
});

describe('format', () => {
  it('formats time', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.25)).toBe('1:05.3');
    expect(formatTime(Number.NaN)).toBe('0:00.0');
  });
  it('clamps seeks', () => {
    expect(clampSeek(Number.NaN, 10)).toBe(0);
    expect(clampSeek(12, 10)).toBe(10);
    expect(clampSeek(-1, 10)).toBe(0);
    expect(clampSeek(3, 10)).toBe(3);
  });
});

describe('Player', () => {
  it('shows an empty state without a composition', () => {
    render(<Player composition={null} />);
    expect(screen.getByTestId('player-empty')).toHaveTextContent('No film yet');
  });

  it('plays, pauses and seeks through the GSAP context', () => {
    render(<Player composition={comp} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(h.ctx.handlePlay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(h.ctx.handlePause).toHaveBeenCalledTimes(1);
    const range = screen.getByLabelText('Seek');
    expect(range).toHaveAttribute('max', '5');
    fireEvent.change(range, { target: { value: '3.5' } });
    expect(h.ctx.handleSeek).toHaveBeenLastCalledWith(3.5);
    expect(screen.getByTestId('player-time')).toHaveTextContent('0:03.5');
    fireEvent.change(range, { target: { value: '99' } });
    expect(h.ctx.handleSeek).toHaveBeenLastCalledWith(5);
  });

  it('sizes the stage with the longest side at 960 and preserves the drawing buffer by default', () => {
    const { rerender } = render(<Player composition={comp} />);
    expect(h.appProps[0]).toMatchObject({ width: 960, height: 540, preserveDrawingBuffer: true });
    rerender(<Player composition={{ ...comp, width: 1080, height: 1920 }} preserveDrawingBuffer={false} />);
    expect(h.appProps.at(-1)).toMatchObject({ width: 540, height: 960, preserveDrawingBuffer: false });
  });

  it('exposes exactly the PlayerHandle', () => {
    const ref = createRef<PlayerHandle>();
    render(<Player ref={ref} composition={comp} />);
    expect(Object.keys(ref.current!).sort()).toEqual(['getApp', 'getCanvas', 'getTime', 'pause', 'play', 'seek']);
    for (const k of Object.keys(ref.current!)) expect(typeof (ref.current as never)[k]).toBe('function');
    expect(ref.current!.getTime()).toBe(1.25);
    expect(ref.current!.getCanvas()).toBe(h.canvas);
    ref.current!.seek(99);
    expect(h.ctx.handleSeek).toHaveBeenLastCalledWith(5);
    ref.current!.play();
    ref.current!.pause();
    expect(h.ctx.handlePlay).toHaveBeenCalled();
    expect(h.ctx.handlePause).toHaveBeenCalled();
  });
});
