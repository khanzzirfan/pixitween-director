// The motion check on rendered frames. It opens a catalog run in the app, seeks each hero film to every step of its length (the player's own
// seek, so a frame is the frame at that time, not a screenshot at some time), reads the canvas, and judges how much each shot moved
// (server/authoring/motion-check.ts). Needs the app running (npm run dev) and a browser with a GPU; no model is called, nothing is spent.
//   npx tsx scripts/motion-check.ts <catalogId> [productId ...]    env: BASE=http://localhost:5181 DATA=data-surf STEP=0.1
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { MOTION_RULES } from '../server/authoring/cinematic-rules';
import { changedShare, judgeMotion, shotMotion, type Gray } from '../server/authoring/motion-check';

const [catalogId, ...only] = process.argv.slice(2);
if (!catalogId) {
  console.error('usage: npx tsx scripts/motion-check.ts <catalogId> [productId ...]');
  process.exit(2);
}
const BASE = process.env.BASE ?? 'http://localhost:5181';
const DATA = process.env.DATA ?? 'data-surf';
const STEP = Number(process.env.STEP ?? MOTION_RULES.stepSec);

const run = JSON.parse(readFileSync(join(DATA, 'catalogs', catalogId, 'run.json'), 'utf8')) as { rows: Array<{ product: { id: string }; status: string }> };
const ids = (only.length ? only : run.rows.filter((r) => r.status !== 'failed').map((r) => r.product.id));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
let failed = 0;
for (const id of ids) {
  const build = JSON.parse(readFileSync(join(DATA, 'catalogs', catalogId, 'build', `${id}.json`), 'utf8')) as { film?: { sheet: { beats: Array<{ seconds: number; move: string }> } } };
  const beats = build.film?.sheet.beats ?? [];
  if (!beats.length) {
    // no board means no hero film: the row plays its tile, which is not what this check measures
    console.log(`\n${id}  PROBLEM: no hero film board in its build`);
    failed++;
    continue;
  }
  let t = 0;
  const shots = beats.map((b) => ({ start: t, end: (t += b.seconds), move: b.move }));
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto(`${BASE}/?catalog=${catalogId}`);
  await page.getByTestId('catalog-head').waitFor();
  await page.locator(`[data-row="${id}"] .catalog-row-btn`).click();
  await page.waitForTimeout(2500);
  const play = page.getByRole('button', { name: /^(Play|Pause)$/ });
  if ((await play.textContent()) === 'Pause') await play.click();
  const slider = page.getByRole('slider', { name: 'Seek' });
  const duration = Number(await slider.getAttribute('max'));
  const canvas = page.locator('[data-testid="slot-player"] canvas').first();

  const times: number[] = [];
  const grays: Gray[] = [];
  for (let at = 0; at <= duration - 0.05; at += STEP) {
    await slider.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, at);
    await page.waitForTimeout(140);
    const png = await canvas.screenshot();
    const { data, info } = await sharp(png).resize(54, 96, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
    times.push(Math.round(at * 100) / 100);
    grays.push({ width: info.width, height: info.height, data });
  }
  const diffs = grays.slice(1).map((g, k) => changedShare(grays[k]!, g));
  const motion = shotMotion(times, diffs, shots);
  const verdict = judgeMotion(motion, MOTION_RULES);
  console.log(`\n${id}  ${duration.toFixed(1)} s, ${grays.length} frames, ${Math.round(verdict.live * 100)}% live`);
  for (const m of motion) console.log(`  shot ${m.shot + 1} ${shots[m.shot]!.move.padEnd(10)} ${m.start.toFixed(1)}-${m.end.toFixed(1)} s  median ${(m.median * 100).toFixed(2)}%  peak ${(m.peak * 100).toFixed(2)}%  (${m.steps} steps)`);
  for (const p of verdict.problems) console.log(`  PROBLEM: ${p}`);
  if (!verdict.ok) failed++;
  await page.close();
}
await browser.close();
console.log(failed ? `\n${failed} film(s) have static shots` : '\nevery film moves');
process.exit(failed ? 1 : 0);
