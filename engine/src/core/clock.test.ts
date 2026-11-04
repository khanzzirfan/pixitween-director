import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionClock, type ClockOptions } from './clock';

// Every clock created here is destroyed after the test so a paused/destroyed timeline never leaks
// into the next test (or leaves the gsap ticker awake).
const clocks: MotionClock[] = [];

function makeClock(opts: ClockOptions): MotionClock {
  const clock = new MotionClock(opts);
  clocks.push(clock);
  return clock;
}

/** Drive a paused/playing timeline to an absolute time with events enabled — deterministic, no waiting. */
function driveTo(clock: MotionClock, sec: number): void {
  clock.timeline.totalTime(sec, false);
}

afterEach(() => {
  for (const clock of clocks.splice(0)) clock.destroy();
  vi.restoreAllMocks();
});

describe('MotionClock', () => {
  it('pins timeline.duration() to the doc duration with no tweens', () => {
    const clock = makeClock({ duration: 6, fps: 30 });
    expect(clock.duration).toBe(6);
    expect(clock.fps).toBe(30);
    expect(clock.timeline.duration()).toBe(6);
    expect(clock.timeline.paused()).toBe(true);
  });

  it('seek clamps to [0, duration] and emits exactly one update per seek', () => {
    const clock = makeClock({ duration: 6, fps: 30 });
    const seen: number[] = [];
    clock.onUpdate((t) => seen.push(t));

    clock.seek(-1);
    expect(clock.time).toBe(0);
    expect(seen).toEqual([0]);

    clock.seek(99);
    expect(clock.time).toBe(6);
    expect(seen).toEqual([0, 6]);
  });

  it('converts between seconds and frames with seekFrame and frameAt', () => {
    const clock = makeClock({ duration: 6, fps: 30 });

    clock.seekFrame(45);
    expect(clock.time).toBe(1.5);
    expect(clock.frameAt(1.5)).toBe(45);
    expect(clock.frameAt()).toBe(45);

    clock.seekFrame(15);
    expect(clock.time).toBe(0.5);
    expect(clock.frameAt()).toBe(15);
  });

  it('a throwing onUpdate listener does not stop the other listeners', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = makeClock({ duration: 6, fps: 30 });
    const seen: number[] = [];

    clock.onUpdate(() => {
      throw new Error('boom');
    });
    clock.onUpdate((t) => seen.push(t));

    clock.seek(3);

    expect(seen).toEqual([3]);
    expect(warn).toHaveBeenCalled();
  });

  it('fires onUpdate while the timeline advances during play', () => {
    const clock = makeClock({ duration: 6, fps: 30 });
    const seen: number[] = [];
    clock.onUpdate((t) => seen.push(t));

    clock.play();
    expect(clock.playing).toBe(true);
    driveTo(clock, 3);

    expect(clock.time).toBe(3);
    expect(seen).toEqual([3]);
  });

  it('without loop, reaching the end pauses at duration and completes exactly once', () => {
    const clock = makeClock({ duration: 6, fps: 30 });
    let completes = 0;
    clock.onComplete(() => {
      completes++;
    });

    clock.play();
    driveTo(clock, 6);

    expect(clock.time).toBe(6);
    expect(clock.playing).toBe(false);
    expect(completes).toBe(1);
  });

  it('with loop, reaching the end wraps to 0, keeps playing and never completes', () => {
    const clock = makeClock({ duration: 6, fps: 30, loop: true });
    let completes = 0;
    clock.onComplete(() => {
      completes++;
    });

    clock.play();
    driveTo(clock, 6);

    expect(clock.time).toBe(0);
    expect(clock.playing).toBe(true);
    expect(completes).toBe(0);
  });

  it('play() restarts from 0 when the playhead sits at the end', () => {
    const clock = makeClock({ duration: 6, fps: 30 });

    clock.seek(6);
    expect(clock.time).toBe(6);
    expect(clock.playing).toBe(false);

    clock.play();
    expect(clock.time).toBe(0);
    expect(clock.playing).toBe(true);
  });

  it('pause() and play() drive the playing state', () => {
    const clock = makeClock({ duration: 6, fps: 30 });
    expect(clock.playing).toBe(false);

    clock.play();
    expect(clock.playing).toBe(true);

    clock.pause();
    expect(clock.playing).toBe(false);
  });

  it('the returned unsubscribe stops further updates', () => {
    const clock = makeClock({ duration: 6, fps: 30 });
    const seen: number[] = [];
    const off = clock.onUpdate((t) => seen.push(t));

    clock.seek(1);
    off();
    clock.seek(2);

    expect(seen).toEqual([1]);
  });

  it('unsubscribing onComplete prevents the callback', () => {
    const clock = makeClock({ duration: 6, fps: 30 });
    let completes = 0;
    const off = clock.onComplete(() => {
      completes++;
    });

    off();
    clock.play();
    driveTo(clock, 6);

    expect(completes).toBe(0);
  });

  it('destroy kills the timeline and drops every listener', () => {
    const clock = makeClock({ duration: 6, fps: 30 });
    const seen: number[] = [];
    clock.onUpdate((t) => seen.push(t));

    clock.destroy();
    clock.seek(3);

    expect(seen).toEqual([]);
  });
});
