export interface StableResult {
  stable: boolean;
  attempts: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls `signature` until two consecutive reads match, so a half-loaded picture is never judged.
 * Gives up after `maxMs`, so at most ceil(maxMs / intervalMs) reads are taken.
 */
export async function waitForStable(
  signature: () => Promise<string>,
  o: { intervalMs?: number; maxMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<StableResult> {
  const intervalMs = o.intervalMs ?? 120;
  const maxMs = o.maxMs ?? 2500;
  const sleep = o.sleep ?? wait;
  const limit = Math.ceil(maxMs / intervalMs);
  let last: string | undefined;
  for (let attempts = 1; ; attempts++) {
    const current = await signature();
    if (last !== undefined && current === last) return { stable: true, attempts };
    last = current;
    if (attempts >= limit) return { stable: false, attempts };
    await sleep(intervalMs);
  }
}

/**
 * True when every pixel of a signature (comma-separated RGBA values) is the same colour: a flat picture, which is
 * what the player shows when it failed to draw the layers. An empty signature is not flat; it is unknown.
 */
export function isFlatSignature(signature: string): boolean {
  const v = signature.split(',').map(Number);
  if (v.length < 8 || v.length % 4 !== 0 || v.some(Number.isNaN)) return false;
  for (let i = 4; i < v.length; i++) if (v[i] !== v[i % 4]) return false;
  return true;
}

export interface CapturedFrame<P> {
  sceneId: string;
  atSec: number;
  rootSec: number;
  unstable: boolean;
  /** The picture is one flat colour, so there is nothing to review in it. */
  blank: boolean;
  image: P;
}

export interface CaptureDriver<P> {
  /** Moves the player to a film time in seconds. */
  seek(rootSec: number): Promise<void>;
  /** Lets this many frames render after a seek before the picture is read. */
  nextFrames(n: number): Promise<void>;
  /** A cheap fingerprint of the current picture, used only for the stability check. */
  signature(): Promise<string>;
  /** Whether the current picture is one flat colour. Drivers that cannot tell leave this out. */
  isBlank?(): Promise<boolean>;
  /** The full-size picture for the frame. */
  extractFull(item: { sceneId: string; atSec: number; rootSec: number }): Promise<P>;
}

/** Captures each planned frame in order: seek, render, wait until stable, then read the full picture. */
export async function captureFrames<P>(
  plan: Array<{ sceneId: string; atSec: number; rootSec: number }>,
  driver: CaptureDriver<P>,
  o: {
    onProgress?: (done: number, total: number) => void;
    intervalMs?: number;
    maxMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Array<CapturedFrame<P>>> {
  const out: Array<CapturedFrame<P>> = [];
  for (const [i, item] of plan.entries()) {
    await driver.seek(item.rootSec);
    await driver.nextFrames(3);
    const stability = await waitForStable(() => driver.signature(), o);
    const blank = (await driver.isBlank?.()) ?? false;
    const image = await driver.extractFull(item);
    out.push({ ...item, unstable: !stability.stable, blank, image });
    o.onProgress?.(i + 1, plan.length);
  }
  return out;
}
