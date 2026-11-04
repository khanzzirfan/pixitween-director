// Ported from reacthub-pixitweenjs src/providers/GsapPixieContextProvider.tsx (MIT).
import { gsap } from 'gsap';

export interface ClockOptions {
  duration: number;
  fps: number;
  loop?: boolean;
}

type UpdateListener = (timeSec: number) => void;
type CompleteListener = () => void;

/**
 * The engine's single clock: a paused GSAP master timeline whose length is pinned to `duration`,
 * plus play/pause/seek and lightweight update/complete subscriptions.
 *
 * Ported idea: `GsapPixieContextProvider`. Dropped: the event bus, reverse mode, drag mode, the
 * Remotion flag, the `+0.2 s` duration buffer and the `0.01 s` seek. The timeline length is pinned
 * with an empty `set` at t = duration so `timeline.duration()` is the doc duration whatever tweens
 * are compiled onto it (see engine/docs/02-timeline.md, "MotionClock (m1)").
 */
export class MotionClock {
  readonly timeline: gsap.core.Timeline;
  readonly duration: number;
  readonly fps: number;

  private readonly loop: boolean;
  private readonly updateListeners = new Set<UpdateListener>();
  private readonly completeListeners = new Set<CompleteListener>();
  private destroyed = false;

  constructor(opts: ClockOptions) {
    this.duration = opts.duration;
    this.fps = opts.fps;
    this.loop = opts.loop ?? false;

    this.timeline = gsap.timeline({
      paused: true,
      defaults: { ease: 'none' },
    });

    // Pin the timeline's length to `duration` even when no tween reaches the end: a zero-duration
    // `set` placed at t = duration makes `timeline.duration()` exactly `duration`.
    this.timeline.set({}, {}, this.duration);

    // gsap's own onUpdate fires whenever the playhead moves during a render; we forward it.
    this.timeline.eventCallback('onUpdate', () => {
      this.emitUpdate(this.timeline.time());
    });

    this.timeline.eventCallback('onComplete', () => {
      if (this.loop) {
        // Reaching the end in loop mode rewinds in place and keeps playing. `restart()` survives
        // the in-flight completion render (mutating the time by hand can be overwritten).
        this.timeline.restart();
        return;
      }
      // Otherwise park exactly on `duration` and notify once.
      this.timeline.pause();
      this.emitComplete();
    });
  }

  get time(): number {
    return this.timeline.time();
  }

  get playing(): boolean {
    return !this.timeline.paused();
  }

  /** Play from the current time, or restart from 0 when the playhead sits at (or past) the end. */
  play(): void {
    if (this.timeline.time() >= this.duration) {
      this.timeline.restart();
    } else {
      this.timeline.play();
    }
  }

  pause(): void {
    this.timeline.pause();
  }

  /** Jump to `sec`, clamped to `[0, duration]`. Emits one update, even while paused. */
  seek(sec: number): void {
    const clamped = Math.min(this.duration, Math.max(0, sec));
    // suppressEvents: gsap must not run its own onUpdate/onComplete for this jump; we emit below.
    this.timeline.seek(clamped, true);
    this.emitUpdate(clamped);
  }

  seekFrame(n: number): void {
    this.seek(n / this.fps);
  }

  /** The frame number for `sec` (defaults to the current time). */
  frameAt(sec?: number): number {
    return Math.round((sec ?? this.time) * this.fps);
  }

  /** Subscribe to playhead updates. Returns an unsubscribe function. */
  onUpdate(fn: UpdateListener): () => void {
    this.updateListeners.add(fn);
    return () => {
      this.updateListeners.delete(fn);
    };
  }

  /** Subscribe to end-of-timeline completion. Returns an unsubscribe function. */
  onComplete(fn: CompleteListener): () => void {
    this.completeListeners.add(fn);
    return () => {
      this.completeListeners.delete(fn);
    };
  }

  /** Kill the timeline and drop every listener. */
  destroy(): void {
    this.destroyed = true;
    this.timeline.eventCallback('onUpdate', null);
    this.timeline.eventCallback('onComplete', null);
    this.timeline.kill();
    this.updateListeners.clear();
    this.completeListeners.clear();
  }

  private emitUpdate(timeSec: number): void {
    if (this.destroyed) return;
    // Snapshot so a listener that unsubscribes mid-loop cannot disturb the iteration.
    for (const fn of [...this.updateListeners]) {
      try {
        fn(timeSec);
      } catch (err) {
        console.warn('[MotionClock] onUpdate listener error:', err);
      }
    }
  }

  private emitComplete(): void {
    if (this.destroyed) return;
    for (const fn of [...this.completeListeners]) {
      try {
        fn();
      } catch (err) {
        console.warn('[MotionClock] onComplete listener error:', err);
      }
    }
  }
}
