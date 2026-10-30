import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilmState } from '@shared/composition';
import type { AudioPlanItem } from '../export/audioPlan';
import { ExportError } from '../export/types';
import ExportPanel from './ExportPanel';

class FakeRecorder { static isTypeSupported = () => true; }
const origCapture = (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = origCapture;
});

const film = (o: Record<string, unknown> = {}) =>
  ({ id: 'film_aaaaaaaaaaaa', title: 'Morning Ritual', composition: { version: '1.9.0', id: 'c', width: 10, height: 10, fps: 30, durationInFrames: 120, assets: {}, layers: [], ...o } }) as unknown as FilmState;
const canvas = (preserved: boolean | null = null) => ({ getContext: () => (preserved === null ? null : { getContextAttributes: () => ({ preserveDrawingBuffer: preserved }) }) }) as unknown as HTMLCanvasElement;
const player = (c = canvas()) => ({ getCanvas: () => c, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), getTime: vi.fn(() => 0) });
const fixedNow = () => new Date('2026-11-02T12:00:00Z');
const mixNone = vi.fn(async () => ({ buffer: null, warnings: [] }));

describe('availability', () => {
  it('disables export when the browser cannot record', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    render(<ExportPanel film={film()} events={[]} getPlayer={() => player()} />);
    expect(screen.getByRole('button', { name: 'Export video' })).toBeDisabled();
    expect(screen.getByText("Your browser can't record video. Try Chrome.")).toBeVisible();
  });
  it('says there is nothing to export without a film', () => {
    render(<ExportPanel film={null} events={[]} />);
    expect(screen.getByRole('button', { name: 'Export video' })).toBeDisabled();
    expect(screen.getByText('Nothing to export')).toBeVisible();
  });
});

describe('recording', () => {
  it('records once with the film duration and the player canvas, then offers the download', async () => {
    const c = canvas();
    const p = player(c);
    const rec = vi.fn(async (_o: unknown) => new Blob(['x']));
    render(<ExportPanel film={film()} events={[]} getPlayer={() => p} deps={{ recordCanvas: rec, mixAudio: mixNone as never, now: fixedNow, mp4Supported: async () => false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
    const link = await screen.findByRole('link');
    expect(rec).toHaveBeenCalledTimes(1);
    expect(rec.mock.calls[0]![0]).toMatchObject({ durationSec: 4, canvas: c });
    expect(link).toHaveAttribute('download', 'morning-ritual-20261102.webm');
    expect(link).toHaveAttribute('href', 'blob:fake');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(screen.getByRole('button', { name: 'Export video' })).toBeInTheDocument();
  });

  it('shows progress and cancels through the abort signal', async () => {
    let signal!: AbortSignal;
    const rec = vi.fn((o: { onProgress: (p: { fraction: number }) => void; signal: AbortSignal }) => {
      signal = o.signal;
      o.onProgress({ fraction: 0.5 });
      return new Promise<Blob>((_, reject) => o.signal.addEventListener('abort', () => reject(new ExportError('aborted'))));
    });
    render(<ExportPanel film={film()} events={[]} getPlayer={() => player()} deps={{ recordCanvas: rec as never, mixAudio: mixNone as never, mp4Supported: async () => false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
    const bar = await screen.findByRole('progressbar');
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal.aborted).toBe(true);
    await screen.findByRole('button', { name: 'Export video' });
  });

  it('warns when the audio could not be mixed and when frames may be blank', async () => {
    const plan: AudioPlanItem[] = [{ layerId: 'a1', assetId: 'a', src: '/a.mp3', source: 'audio', startSec: 0, endSec: 1, gain: [[0, 1]] }];
    const withAudio = film({ assets: { a: { type: 'audio', src: '/a.mp3' } }, layers: [{ kind: 'audio', id: 'a1', assetId: 'a', inPoint: 0, outPoint: 30, transform: {} }] });
    void plan;
    render(<ExportPanel film={withAudio} events={[]} getPlayer={() => player(canvas(false))} deps={{ recordCanvas: async () => new Blob(['x']), mixAudio: mixNone as never, now: fixedNow, mp4Supported: async () => false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
    await screen.findByRole('link');
    expect(screen.getByText('Exported without audio')).toBeInTheDocument();
    expect(screen.getByText('Export may produce blank frames in this browser.')).toBeInTheDocument();
  });

  it('shows an error and lets the user try again', async () => {
    render(<ExportPanel film={film()} events={[]} getPlayer={() => player()} deps={{ recordCanvas: async () => { throw new ExportError('tab-hidden', 'Keep the tab in the foreground'); }, mixAudio: mixNone as never, mp4Supported: async () => false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep the tab in the foreground');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'Export video' })).toBeInTheDocument();
  });
});

describe('mp4 option', () => {
  it('appears only when supported, and names the file .mp4', async () => {
    const mp4 = vi.fn(async () => new Blob(['m']));
    const { unmount } = render(<ExportPanel film={film()} events={[]} getPlayer={() => player()} deps={{ mp4Supported: async () => false }} />);
    await waitFor(() => expect(screen.queryByRole('option', { name: 'MP4 (experimental)' })).toBeNull());
    unmount();
    render(<ExportPanel film={film()} events={[]} getPlayer={() => player()} deps={{ mp4Supported: async () => true, exportMp4: mp4 as never, mixAudio: mixNone as never, now: fixedNow }} />);
    await screen.findByRole('option', { name: 'MP4 (experimental)' });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'mp4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
    expect(await screen.findByRole('link')).toHaveAttribute('download', 'morning-ritual-20261102.mp4');
    expect(mp4).toHaveBeenCalledTimes(1);
  });
});

describe('a 3D product (S13b)', () => {
  const p3d = (ready: boolean) => ({ ...player(), whenReady: vi.fn(async () => ready) });

  it('waits for the 3D product before it records', async () => {
    const p = p3d(true);
    const rec = vi.fn(async (_o: unknown) => new Blob(['x']));
    render(<ExportPanel film={film()} events={[]} getPlayer={() => p} deps={{ recordCanvas: rec, mixAudio: mixNone as never, now: fixedNow, mp4Supported: async () => false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
    await screen.findByRole('link');
    expect(p.whenReady).toHaveBeenCalledWith(20);
    expect(rec).toHaveBeenCalledTimes(1);
  });

  it('never starts the recorder when the 3D product did not draw, and says so', async () => {
    const p = p3d(false);
    const rec = vi.fn(async (_o: unknown) => new Blob(['x']));
    const mix = vi.fn(async () => ({ buffer: null, warnings: [] }));
    render(<ExportPanel film={film()} events={[]} getPlayer={() => p} deps={{ recordCanvas: rec, mixAudio: mix as never, now: fixedNow, mp4Supported: async () => false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
    expect(await screen.findByText(/3D product did not finish drawing/)).toBeVisible();
    expect(rec).not.toHaveBeenCalled();
    expect(mix).not.toHaveBeenCalled();
  });
});
