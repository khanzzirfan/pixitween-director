import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Storyboard } from '@shared/storyboard';
import type { PlayerHandle } from '../player/Player';
import type { ReviewCapture } from '../capture/driver';
import type { CaptureRequest } from './crewReducer';
import { useCaptureRequests, type CaptureDeps } from './useCaptureRequests';

const storyboard = { title: 't', aspect: '16:9', durationSec: 8, palette: ['#000000'], scenes: [{ id: 's1', durationSec: 4 }, { id: 's2', durationSec: 4 }] } as unknown as Storyboard;
const req = (id: string, sceneId = 's1', times = [0.8, 2]): CaptureRequest => ({ requestId: id, sceneId, timesSec: times, at: new Date().toISOString() });

function fakePlayer(log: string[]): PlayerHandle {
  let t = 1.5;
  return { getCanvas: () => document.createElement('canvas'), getApp: () => null, play: () => void log.push('play'), pause: () => void log.push('pause'), seek: (s) => void (log.push(`seek ${s}`), (t = s)), getTime: () => t };
}
const blob = () => new Blob(['png'], { type: 'image/png' });

function Harness({ requests, deps, player }: { requests: CaptureRequest[]; deps: CaptureDeps; player: PlayerHandle }) {
  useCaptureRequests({ filmId: 'film_0123456789ab', requests, storyboard, getPlayer: () => player, deps, maxAgeMs: Infinity, sampleMs: 0 });
  return null;
}

describe('useCaptureRequests', () => {
  it('captures requests one after the other, never together', async () => {
    const log: string[] = [];
    let active = 0;
    let max = 0;
    const deps: CaptureDeps = {
      capture: async (_p, _s, r) => {
        active++;
        max = Math.max(max, active);
        log.push(`capture ${r.requestId}`);
        await new Promise((res) => setTimeout(res, 20));
        active--;
        return { frames: r.timesSec.map((atSec) => ({ sceneId: r.sceneId, atSec, blob: blob(), unstable: false, blank: false })), textBoxes: {} } satisfies ReviewCapture;
      },
      post: vi.fn(async () => ({})),
    };
    render(<Harness requests={[req('r1'), req('r2', 's2')]} deps={deps} player={fakePlayer(log)} />);
    await waitFor(() => expect(deps.post).toHaveBeenCalledTimes(2));
    expect(max).toBe(1);
    expect(log.filter((l) => l.startsWith('capture'))).toEqual(['capture r1', 'capture r2']);
  });

  it('posts the request id and one png per requested time, then restores the player', async () => {
    const log: string[] = [];
    const post = vi.fn(async () => ({}));
    const deps: CaptureDeps = {
      capture: async (_p, _s, r) => ({ frames: r.timesSec.map((atSec) => ({ sceneId: r.sceneId, atSec, blob: blob(), unstable: false, blank: false })), textBoxes: { 's1:headline': { frame: 24, box: { left: 1, top: 2, right: 3, bottom: 4 } } } }),
      post,
    };
    render(<Harness requests={[req('r9')]} deps={deps} player={fakePlayer(log)} />);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const form = (post.mock.calls[0] as unknown as [string, FormData])[1];
    expect(form.get('requestId')).toBe('r9');
    expect(form.getAll('frames')).toHaveLength(2);
    expect(JSON.parse(form.get('meta') as string)).toEqual([{ sceneId: 's1', atSec: 0.8 }, { sceneId: 's1', atSec: 2 }]);
    expect(form.get('textBoxes')).toContain('s1:headline');
    expect(log[0]).toBe('pause');
    expect(log.at(-1)).toBe('seek 1.5'); // back where it was
  });

  it('answers a request once, and skips a stale one', async () => {
    const post = vi.fn(async () => ({}));
    const deps: CaptureDeps = { capture: async () => ({ frames: [], textBoxes: {} }), post };
    const { rerender } = render(<Harness requests={[req('r1')]} deps={deps} player={fakePlayer([])} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    rerender(<Harness requests={[req('r1')]} deps={deps} player={fakePlayer([])} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(post).toHaveBeenCalledTimes(1);
  });
});
