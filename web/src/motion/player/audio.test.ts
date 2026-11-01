import { describe, expect, it, vi } from 'vitest';
import type { AudioCue } from '../aep';
import { createAudioSync, type AudioLike } from './audio';

function fake(): AudioLike & { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> } {
  const el = {
    src: '',
    volume: 1,
    currentTime: 0,
    paused: true,
    play: vi.fn(() => {
      el.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      el.paused = true;
    }),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
  return el;
}

function setup(cues: AudioCue[]) {
  const els: ReturnType<typeof fake>[] = [];
  const sync = createAudioSync(cues, {
    createAudio: (url) => {
      const el = fake();
      el.src = url;
      els.push(el);
      return el;
    },
  });
  return { sync, els };
}

const cue = (startSec: number, endSec: number, level = 0.5): AudioCue => ({ id: 'a', url: 'a.mp3', startSec, endSec, level });

describe('createAudioSync', () => {
  it('seek sets currentTime, play calls play once, pause pauses all', () => {
    const { sync, els } = setup([cue(0, 24), cue(0, 24)]);
    expect(els[0].volume).toBe(0.5);
    sync.seek(5);
    expect(els[0].currentTime).toBe(5);
    sync.play(5);
    expect(els[0].play).toHaveBeenCalledTimes(1);
    sync.pause();
    expect(els[0].pause).toHaveBeenCalled();
    expect(els[1].paused).toBe(true);
  });

  it('only plays inside its window', () => {
    const { sync, els } = setup([cue(10, 20)]);
    sync.play(5);
    expect(els[0].play).not.toHaveBeenCalled();
    expect(els[0].paused).toBe(true);
    sync.sync(12);
    expect(els[0].currentTime).toBe(2);
    expect(els[0].play).toHaveBeenCalledTimes(1);
    sync.sync(20);
    expect(els[0].paused).toBe(true);
  });

  it('resyncs only past the drift threshold', () => {
    const { sync, els } = setup([cue(0, 24)]);
    sync.play(1);
    els[0].currentTime = 1.1;
    sync.sync(1.2);
    expect(els[0].currentTime).toBe(1.1);
    sync.sync(2);
    expect(els[0].currentTime).toBe(2);
  });

  it('dispose pauses and releases every element', () => {
    const { sync, els } = setup([cue(0, 24), cue(0, 5)]);
    sync.play(1);
    sync.dispose();
    for (const el of els) {
      expect(el.paused).toBe(true);
      expect(el.removeAttribute).toHaveBeenCalledWith('src');
      expect(el.load).toHaveBeenCalled();
    }
    expect(() => sync.sync(2)).not.toThrow();
  });
});
