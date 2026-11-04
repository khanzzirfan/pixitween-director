// Server-side export check, no visible browser: renders a film's frames in headless Chromium (the stage-check page), uploads them to the server's
// /api/exports route, lets the server's ffmpeg encode the MP4 and its own check judge it. Needs the server (8787) and the web dev server (5173) running.
//   npx tsx scripts/export-film.ts <filmId> [fps=15] [outDir=debug/export-test]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [filmId, fpsArg, outArg] = process.argv.slice(2);
if (!filmId) {
  console.error('usage: npx tsx scripts/export-film.ts <filmId> [fps] [outDir]');
  process.exit(2);
}
const API = process.env.API ?? 'http://localhost:8787';
const WEB = process.env.WEB ?? 'http://localhost:5173';
const fps = Number(fpsArg ?? 15);
const outDir = outArg ?? 'debug/export-test';

const film = (await (await fetch(`${API}/api/films/${filmId}`)).json()) as { composition: { width: number; height: number; durationInFrames: number; fps: number } };
const comp = film.composition;
const durationSec = comp.durationInFrames / comp.fps;
const frames = Math.ceil(durationSec * fps);
console.log(`film ${filmId}: ${comp.width}x${comp.height}, ${durationSec}s -> ${frames} frames at ${fps} fps`);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: Math.round(((comp.height / comp.width) * 1080) / 0.6) + 40 } });
  await page.route('**/__export-film.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(comp ? (film as { composition: unknown }).composition : {}) }));
  await page.goto(`${WEB}/stage-check.html?film=live&file=${encodeURIComponent('/__export-film.json')}`);
  await page.waitForFunction(() => Boolean((window as unknown as { __stage?: unknown }).__stage), undefined, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const ready = await page.evaluate(() => (window as unknown as { __stage: { whenReady(s: number): Promise<boolean> } }).__stage.whenReady(20));
  if (!ready) throw new Error('a 3D layer did not draw in time');

  const canvas = page.locator('canvas').first();
  let size = { width: 0, height: 0 };
  let id = '';
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((s) => (window as unknown as { __stage: { seek(s: number): Promise<void> } }).__stage.seek(s), i / fps);
    await page.waitForTimeout(150);
    const jpg = await canvas.screenshot({ type: 'jpeg', quality: 90 });
    if (i === 0) {
      const box = (await canvas.boundingBox())!;
      size = { width: Math.round(box.width), height: Math.round(box.height) };
      console.log(`canvas ${size.width}x${size.height}`);
      const start = await fetch(`${API}/api/exports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fps, frames, ...size }) });
      if (!start.ok) throw new Error(`start failed ${start.status} ${await start.text()}`);
      id = ((await start.json()) as { id: string }).id;
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'frame-first.jpg'), jpg);
    }
    if (i === Math.floor(frames / 2)) await writeFile(join(outDir, 'frame-mid.jpg'), jpg);
    const put = await fetch(`${API}/api/exports/${id}/frames/${i}`, { method: 'PUT', body: new Uint8Array(jpg) });
    if (!put.ok) throw new Error(`frame ${i} upload failed ${put.status}`);
    if (i % 25 === 0) console.log(`frame ${i}/${frames} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  const fin = await fetch(`${API}/api/exports/${id}/finish`, { method: 'POST' });
  if (!fin.ok) throw new Error(`finish failed ${fin.status} ${await fin.text()}`);
  const problems = JSON.parse(fin.headers.get('x-export-problems') ?? '[]') as string[];
  const mp4 = join(outDir, `${filmId}.mp4`);
  await writeFile(mp4, Buffer.from(await fin.arrayBuffer()));
  console.log(`wrote ${mp4}`);
  console.log(problems.length ? `server check problems:\n - ${problems.join('\n - ')}` : 'server check: no problems');
} finally {
  await browser.close();
}
