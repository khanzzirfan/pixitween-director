// Server-side film render: plays a composition in headless Chromium (the app's own stage page, so the picture is the one the user sees),
// writes one JPEG per frame to a folder and reports progress. The web dev server must be reachable at EXPORT_RENDER_BASE.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { frameName } from '../media/encode';

export interface RenderOptions {
  composition: unknown;
  /** The composition's own size in pixels. The output is exactly this at scale 2 and half of it at scale 1. */
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Device scale factor: 1 renders at half the composition size (the stage canvas is 540 px wide), 2 at full size. */
  scale: 1 | 2;
  framesDir: string;
  base: string;
  signal?: AbortSignal;
  onFrame?(done: number, total: number): void;
}

const SETTLE_MS = 150;
const READY_WAIT_SEC = 20;
const STAGE_WAIT_MS = 30_000;

type Stage = { seek(s: number): Promise<void>; whenReady(s: number): Promise<boolean> };

export class RenderError extends Error {
  constructor(
    readonly code: 'not-ready' | 'aborted' | 'page-error' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'RenderError';
  }
}

/** Whether a headless Chromium can be launched here. Cheap: it only looks for the browser binary. */
export async function renderAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    const { access } = await import('node:fs/promises');
    await access(chromium.executablePath());
    return true;
  } catch {
    return false;
  }
}

const loadPlaywright = () => import('playwright');

export async function renderFrames(o: RenderOptions): Promise<{ width: number; height: number }> {
  let pw: Awaited<ReturnType<typeof loadPlaywright>>;
  try {
    pw = await loadPlaywright();
  } catch {
    throw new RenderError('unavailable', 'This server has no headless browser, so it cannot render a video.');
  }
  const aborted = () => new RenderError('aborted', 'Export cancelled');
  if (o.signal?.aborted) throw aborted();
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const onAbort = () => void browser.close().catch(() => undefined);
  o.signal?.addEventListener('abort', onAbort);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 3240 }, deviceScaleFactor: o.scale });
    const page = await ctx.newPage();
    let pageError: string | null = null;
    page.on('pageerror', (e) => (pageError ??= e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /player error|layer error/i.test(m.text())) pageError ??= m.text();
    });
    await page.route('**/__export-film.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o.composition) }));
    await page.goto(`${o.base}/stage-check.html?film=live&file=${encodeURIComponent('/__export-film.json')}`);
    await page.waitForFunction(() => Boolean((window as unknown as { __stage?: unknown }).__stage), undefined, { timeout: STAGE_WAIT_MS });
    await page.waitForTimeout(3000); // the layers are added after the page's first paint
    const ready = await page.evaluate((s) => (window as unknown as { __stage: Stage }).__stage.whenReady(s), READY_WAIT_SEC);
    if (!ready) throw new RenderError('not-ready', 'The 3D product did not finish drawing, so nothing was exported. Wait a moment and try again.');

    // the stage lays the canvas out by percentage, which rounds to a pixel off: pin it so every frame is exactly the composition size
    await page.addStyleTag({ content: `canvas{position:fixed!important;left:0!important;top:0!important;margin:0!important;z-index:2147483647!important;width:${o.width / 2}px!important;height:${o.height / 2}px!important;max-width:none!important;max-height:none!important}` });
    await page.waitForTimeout(300);
    const clip = { x: 0, y: 0, width: o.width / 2, height: o.height / 2 };
    let size = { width: 0, height: 0 };
    for (let i = 0; i < o.frames; i++) {
      if (o.signal?.aborted) throw aborted();
      if (pageError) throw new RenderError('page-error', `The film failed to draw: ${pageError}`);
      await page.evaluate((s) => (window as unknown as { __stage: Stage }).__stage.seek(s), i / o.fps);
      await page.waitForTimeout(SETTLE_MS);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 90, clip });
      if (i === 0) {
        size = { width: clip.width * o.scale, height: clip.height * o.scale };
      }
      await writeFile(join(o.framesDir, frameName(i)), jpg);
      o.onFrame?.(i + 1, o.frames);
    }
    return size;
  } catch (e) {
    if (o.signal?.aborted) throw aborted();
    throw e;
  } finally {
    o.signal?.removeEventListener('abort', onAbort);
    await browser.close().catch(() => undefined);
  }
}
