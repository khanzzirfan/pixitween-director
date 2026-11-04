// Audio cues kept in sync with the Motion runtime clock. One HTMLAudioElement per cue; a cue sounds
// only while startSec <= t < endSec, at currentTime = t - startSec.
import type { AudioCue } from '../aep';

/** Minimal slice of HTMLAudioElement used here, so tests can pass fakes. */
export interface AudioLike {
  src: string;
  volume: number;
  currentTime: number;
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  removeAttribute?(name: string): void;
  load?(): void;
}

export interface AudioSyncOptions {
  createAudio?(url: string): AudioLike;
  /** Seconds of drift tolerated before currentTime is re-set while playing. Default 0.15. */
  driftSec?: number;
}

export interface AudioSync {
  play(t: number): void;
  pause(): void;
  seek(t: number): void;
  /** Call every frame while playing: starts/stops cues at their edges and corrects drift. */
  sync(t: number): void;
  dispose(): void;
}

const DEFAULT_DRIFT = 0.15;

function defaultCreateAudio(url: string): AudioLike {
  const el = new Audio(url);
  el.preload = 'auto';
  return el;
}

export function createAudioSync(cues: readonly AudioCue[], opts: AudioSyncOptions = {}): AudioSync {
  const create = opts.createAudio ?? defaultCreateAudio;
  const drift = opts.driftSec ?? DEFAULT_DRIFT;
  let items: { cue: AudioCue; el: AudioLike }[] | null = cues.map((cue) => {
    const el = create(cue.url);
    el.volume = Math.min(1, Math.max(0, cue.level));
    return { cue, el };
  });
  let playing = false;

  const inWindow = (cue: AudioCue, t: number) => t >= cue.startSec && t < cue.endSec;
  const safePlay = (el: AudioLike) => {
    try {
      void Promise.resolve(el.play()).catch(() => undefined); // autoplay policy / decode errors
    } catch {
      /* ignore */
    }
  };

  function apply(t: number, forceTime: boolean) {
    for (const { cue, el } of items ?? []) {
      if (!inWindow(cue, t)) {
        if (!el.paused) el.pause();
        continue;
      }
      const local = t - cue.startSec;
      if (forceTime || el.paused || Math.abs(el.currentTime - local) > drift) el.currentTime = local;
      if (playing && el.paused) safePlay(el);
    }
  }

  return {
    play(t) {
      playing = true;
      apply(t, true);
    },
    pause() {
      playing = false;
      for (const { el } of items ?? []) if (!el.paused) el.pause();
    },
    seek(t) {
      apply(t, true);
    },
    sync(t) {
      if (playing) apply(t, false);
    },
    dispose() {
      playing = false;
      for (const { el } of items ?? []) {
        el.pause();
        el.removeAttribute?.('src');
        el.load?.();
      }
      items = null;
    },
  };
}
