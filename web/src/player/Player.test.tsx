import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { clampSeek, formatTime } from './format';
import Player, { type PlayerHandle } from './Player';

const h = vi.hoisted(() => ({
  ctx: { handlePlay: vi.fn(), handlePause: vi.fn(), handleSeek: vi.fn(), playerTimeRef: { current: 1.25 } },
  appProps: [] as Array<Record<string, unknown>>,
  compProps: [] as Array<Record<string, unknown>>,
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
    AepComposition: (props: Record<string, unknown>) => {
      h.compProps.push(props);
      return <div data-testid="aep" />;
    },
  };
});

const comp = { version: '1.9.0', id: 'c', width: 1920, height: 1080, fps: 30, durationInFrames: 150, layers: [], assets: {} } as AepCompositionJson;

beforeEach(() => {
  Object.values(h.ctx).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockClear());
  h.appProps.length = 0;
  h.compProps.length = 0;
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
    expect(Object.keys(ref.current!).sort()).toEqual(['getApp', 'getCanvas', 'getTime', 'pause', 'play', 'seek', 'whenReady']);
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

describe('whenReady (S13b)', () => {
  const with3D = { ...comp, precomps: { s1: { layers: [{ id: 's1:product3d', kind: 'model3d' }] } } } as unknown as AepCompositionJson;
  const mount = (c: AepCompositionJson, engineVersion?: string) => {
    const ref = createRef<PlayerHandle>();
    render(<Player ref={ref} composition={c} engineVersion={engineVersion} />);
    return ref;
  };
  const lastProps = () => h.compProps.at(-1)!;

  it('resolves true at once for a composition without model3d, and does not ask the engine', async () => {
    const ref = mount(comp);
    expect(await ref.current!.whenReady(10)).toBe(true);
    expect(lastProps().onRenderReady).toBeUndefined();
  });

  it("resolves true after the engine's onRenderReady fires", async () => {
    const ref = mount(with3D);
    let value: boolean | undefined;
    void ref.current!.whenReady(10).then((v) => (value = v));
    await Promise.resolve();
    expect(value).toBeUndefined();
    (lastProps().onRenderReady as () => void)();
    await Promise.resolve();
    expect(value).toBe(true);
    expect(await ref.current!.whenReady(10)).toBe(true);
  });

  it('resolves false after the timeout when onRenderReady never fires', async () => {
    vi.useFakeTimers();
    try {
      const ref = mount(with3D);
      let value: boolean | undefined;
      void ref.current!.whenReady(10).then((v) => (value = v));
      await vi.advanceTimersByTimeAsync(9_999);
      expect(value).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2);
      expect(value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves false at once when a 3D layer fails, and passes the error on', async () => {
    const onLayerError = vi.fn();
    const ref = createRef<PlayerHandle>();
    render(<Player ref={ref} composition={with3D} onLayerError={onLayerError} />);
    const pending = ref.current!.whenReady(10);
    (lastProps().onLayerError as (id: string, e: unknown) => void)('s1:product3d', new Error('texture failed'));
    expect(await pending).toBe(false);
    expect(onLayerError).toHaveBeenCalledWith('s1:product3d', expect.any(Error));
  });

  it('still renders and resolves true against an engine that has no onRenderReady (feature check)', async () => {
    const ref = mount(with3D, '0.2.9');
    expect(screen.getByTestId('aep')).toBeInTheDocument();
    expect(lastProps().onRenderReady).toBeUndefined();
    expect(await ref.current!.whenReady(10)).toBe(true);
  });

  it('knows which engine versions report readiness', async () => {
    const { supportsRenderReady, versionAtLeast } = await import('./useCompositionReady');
    expect(supportsRenderReady('0.3.0-alpha.5')).toBe(true);
    expect(supportsRenderReady('0.3.0-alpha.4')).toBe(true);
    expect(supportsRenderReady('0.3.0-alpha.3')).toBe(false);
    expect(supportsRenderReady('0.2.9')).toBe(false);
    expect(supportsRenderReady('0.3.0')).toBe(true);
    expect(supportsRenderReady('1.0.0-beta.1')).toBe(true);
    expect(versionAtLeast('0.3.0-alpha.10', '0.3.0-alpha.4')).toBe(true);
  });
});
