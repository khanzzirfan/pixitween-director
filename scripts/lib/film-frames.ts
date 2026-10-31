// Frames of a built film, taken in headless Chromium from the dev page web/stage-check.html. The web dev server must be running (npm run dev:web).
import type { Buffer } from 'node:buffer';
import { chromium } from 'playwright';

/** One PNG per time (seconds) of the film at `file` (a path under web/public, such as /cartoon/catalog-cine/cb-original.json). */
export async function filmFrames(o: { base?: string; file: string; times: number[] }): Promise<Buffer[]> {
  const base = o.base ?? 'http://localhost:5173';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    await page.goto(`${base}/stage-check.html?film=live&file=${encodeURIComponent(o.file)}`);
    await page.waitForFunction(() => Boolean((window as unknown as { __stage?: unknown }).__stage), undefined, { timeout: 30000 });
    await page.waitForTimeout(3000); // the layers are added after the page's first paint
    const ready = await page.evaluate(() => (window as unknown as { __stage: { whenReady(s: number): Promise<boolean> } }).__stage.whenReady(20));
    if (!ready) throw new Error('a 3D layer did not draw in time');
    const out: Buffer[] = [];
    for (const t of o.times) {
      await page.evaluate((s) => (window as unknown as { __stage: { seek(s: number): Promise<void> } }).__stage.seek(s), t);
      await page.waitForTimeout(700);
      out.push(await page.locator('canvas').first().screenshot({ type: 'png' }));
    }
    return out;
  } finally {
    await browser.close();
  }
}
