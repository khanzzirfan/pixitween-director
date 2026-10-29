import { describe, expect, it } from 'vitest';
import { planFrames } from './plan';
import { fitTransform, toCompSpace } from './fit';
import { captureFrames, isFlatSignature, waitForStable } from './stable';
import { measureTextBoxes, findTextNode, type PixiNodeLike } from './measure';

describe('planFrames', () => {
  it('samples a scene at 0.8, 2 and 3.2 s, with the film time equal to the scene time at the start', () => {
    const plan = planFrames([{ id: 's1', startSec: 0, durationSec: 4 }]);
    expect(plan.map((p) => p.atSec)).toEqual([0.8, 2, 3.2]);
    expect(plan.map((p) => p.rootSec)).toEqual([0.8, 2, 3.2]);
  });
  it('rounds to capture frames and offsets later scenes by their start', () => {
    const plan = planFrames([{ id: 's2', startSec: 4, durationSec: 3.3 }]);
    expect(plan.map((p) => p.atSec)).toEqual([0.6667, 1.6667, 2.6333]);
    expect(plan.map((p) => p.rootSec)).toEqual([4.6667, 5.6667, 6.6333]);
  });
  it('skips generate-mode scenes', () => {
    expect(planFrames([{ id: 's1', startSec: 0, durationSec: 4, mode: 'generate' }])).toEqual([]);
  });
});

describe('fitTransform and toCompSpace', () => {
  it('maps a half-size stage with no offset', () => {
    const t = fitTransform({ w: 960, h: 540 }, { w: 1920, h: 1080 });
    expect(t).toEqual({ scale: 0.5, offsetX: 0, offsetY: 0 });
    expect(toCompSpace({ x: 100, y: 50, width: 200, height: 40 }, t)).toEqual({ left: 200, top: 100, right: 600, bottom: 180 });
  });
  it('letterboxes a square stage and maps the picture back to the full frame', () => {
    const t = fitTransform({ w: 1000, h: 1000 }, { w: 1920, h: 1080 });
    expect(t.scale).toBeCloseTo(0.5208, 4);
    expect(t.offsetY).toBeCloseTo(218.75, 2);
    const full = toCompSpace({ x: 0, y: 218.75, width: 1000, height: 562.5 }, t);
    expect(full.left).toBeCloseTo(0, 2);
    expect(full.top).toBeCloseTo(0, 2);
    expect(full.right).toBeCloseTo(1920, 1);
    expect(full.bottom).toBeCloseTo(1080, 1);
  });
});

describe('waitForStable', () => {
  const noSleep = async () => undefined;
  it('is stable after two equal reads', async () => {
    const reads = ['a', 'a'];
    expect(await waitForStable(async () => reads.shift()!, { sleep: noSleep })).toEqual({ stable: true, attempts: 2 });
  });
  it('gives up after at most 21 reads when the picture keeps changing', async () => {
    let n = 0;
    const out = await waitForStable(async () => String(n++), { intervalMs: 120, maxMs: 2500, sleep: noSleep });
    expect(out.stable).toBe(false);
    expect(out.attempts).toBeLessThanOrEqual(21);
  });
});

describe('isFlatSignature', () => {
  const px = (r: number, g: number, b: number, n: number) => Array.from({ length: n }, () => `${r},${g},${b},255`).join(',');
  it('is true for one colour everywhere and false once any pixel differs', () => {
    expect(isFlatSignature(px(245, 230, 211, 576))).toBe(true);
    expect(isFlatSignature(`${px(245, 230, 211, 575)},10,10,10,255`)).toBe(false);
  });
  it('treats an empty or malformed signature as unknown, not flat', () => {
    for (const s of ['', 'no-canvas', 'no-2d', '1,2,3,4']) expect(isFlatSignature(s)).toBe(false);
  });
});

describe('captureFrames', () => {
  it('flags a frame the driver reports as blank, and defaults to not blank when it cannot tell', async () => {
    const base = { async seek() {}, async nextFrames() {}, async signature() { return 's'; }, async extractFull() { return 'img'; } };
    const item = [{ sceneId: 's1', atSec: 1, rootSec: 1 }];
    const sleep = async () => undefined;
    expect((await captureFrames(item, { ...base, async isBlank() { return true; } }, { sleep }))[0]!.blank).toBe(true);
    expect((await captureFrames(item, base, { sleep }))[0]!.blank).toBe(false);
  });

  it('seeks in plan order, waits three frames each time, reports progress and reads each frame once', async () => {
    const plan = [
      { sceneId: 's1', atSec: 0.8, rootSec: 0.8 },
      { sceneId: 's1', atSec: 2, rootSec: 2 },
      { sceneId: 's1', atSec: 3.2, rootSec: 3.2 },
    ];
    const log: string[] = [];
    const progress: number[] = [];
    const out = await captureFrames(
      plan,
      {
        async seek(t) {
          log.push(`seek ${t}`);
        },
        async nextFrames(n) {
          log.push(`next ${n}`);
        },
        async signature() {
          return 'same';
        },
        async extractFull(item) {
          log.push(`full ${item.atSec}`);
          return `img-${item.atSec}`;
        },
      },
      { onProgress: (done) => progress.push(done), sleep: async () => undefined },
    );
    expect(log.filter((l) => l.startsWith('seek'))).toEqual(['seek 0.8', 'seek 2', 'seek 3.2']);
    expect(log.filter((l) => l.startsWith('next'))).toEqual(['next 3', 'next 3', 'next 3']);
    expect(progress).toEqual([1, 2, 3]);
    expect(out.map((f) => f.unstable)).toEqual([false, false, false]);
    expect(log.filter((l) => l.startsWith('full'))).toHaveLength(3);
  });
  it('keeps an unstable frame but marks it', async () => {
    let n = 0;
    const out = await captureFrames(
      [{ sceneId: 's1', atSec: 1, rootSec: 1 }],
      {
        async seek() {},
        async nextFrames() {},
        async signature() {
          return String(n++);
        },
        async extractFull() {
          return 'frame';
        },
      },
      { sleep: async () => undefined, maxMs: 240, intervalMs: 120 },
    );
    expect(out[0]).toMatchObject({ unstable: true, image: 'frame' });
  });
});

describe('measureTextBoxes', () => {
  const textNode = { label: 'caption', text: 'Slow', getBounds: () => ({ x: 100, y: 50, width: 200, height: 40 }) };
  const container: PixiNodeLike = {
    label: 'container-s1:caption',
    children: [{ getBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }) }, textNode],
  };
  const stage = {
    getChildByLabel(label: string) {
      return label === 'container-s1:caption' ? container : null;
    },
  };
  it('measures the text node, not the comp-sized sprite beside it', () => {
    expect(measureTextBoxes(stage, { w: 960, h: 540 }, { w: 1920, h: 1080 }, ['s1:caption'])).toEqual({
      's1:caption': { left: 200, top: 100, right: 600, bottom: 180 },
    });
  });
  it('leaves out layers with no container or no text node', () => {
    expect(measureTextBoxes(stage, { w: 960, h: 540 }, { w: 1920, h: 1080 }, ['s1:headline'])).toEqual({});
    const bare = { getChildByLabel: () => ({ children: [{ getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }) }] }) };
    expect(measureTextBoxes(bare, { w: 960, h: 540 }, { w: 1920, h: 1080 }, ['s1:caption'])).toEqual({});
  });
  it('finds a text node nested two levels down', () => {
    const deep: PixiNodeLike = { children: [{ children: [{ text: 'hi', getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }) }] }] };
    expect(findTextNode(deep)?.text).toBe('hi');
  });
});
