import { forwardRef, useImperativeHandle } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import * as client from '../api/client';

const h = vi.hoisted(() => ({ canvas: {} as HTMLCanvasElement, captureStream: vi.fn() }));

// The real Player needs WebGL; this stand-in exposes the same handle so the App wiring is what gets tested.
vi.mock('../player/Player', async () => ({
  default: forwardRef(function Player(_props: unknown, ref) {
    useImperativeHandle(ref, () => ({ getCanvas: () => h.canvas, getApp: () => null, play: () => undefined, pause: () => undefined, seek: () => undefined, getTime: () => 99 }));
    return <div data-testid="player-stub" />;
  }),
}));

class FakeRecorder {
  static isTypeSupported = () => true;
  onstart?: () => void;
  onstop?: () => void;
  ondataavailable?: (e: { data: Blob }) => void;
  constructor(public stream: unknown) {}
  start() { this.onstart?.(); }
  stop() { queueMicrotask(() => this.onstop?.()); }
}
class FakeStream { constructor(public tracks: unknown[] = []) {} getTracks() { return this.tracks; } addTrack() {} }

beforeEach(() => {
  h.canvas = { captureStream: h.captureStream.mockReturnValue({ getVideoTracks: () => [] }), getContext: () => null } as unknown as HTMLCanvasElement;
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('EventSource', class { addEventListener() {} close() {} });
  (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream = () => undefined;
  URL.createObjectURL = vi.fn(() => 'blob:x');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  h.captureStream.mockClear();
  window.history.replaceState({}, '', '/');
});

const film = { id: 'film_3fa9c2d41b7e', title: 'Mug', status: 'ready', composition: { version: '1.9.0', id: 'c', width: 10, height: 10, fps: 30, durationInFrames: 60, assets: {}, layers: [] } };

it('shows Nothing to export with no film', () => {
  render(<App />);
  expect(screen.getByText('Nothing to export')).toBeInTheDocument();
});

it('exports the film shown in the Player slot', async () => {
  vi.spyOn(client.api, 'getFilm').mockResolvedValue(film as never);
  window.history.replaceState({}, '', '/?film=film_3fa9c2d41b7e');
  render(<App />);
  fireEvent.click(await screen.findByTestId('rail-export')); // the export panel sits behind a rail tab
  const button = await screen.findByRole('button', { name: 'Export video' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(h.captureStream).toHaveBeenCalledTimes(1));
});
