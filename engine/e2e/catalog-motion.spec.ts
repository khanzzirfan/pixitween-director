import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Every film the catalogue run produced (web/public/cartoon/catalog/*.json, listed by index.json) must parse,
// convert with no "skipped" warning, and play on the Three.js engine at /aep-motion.html?src=...:
// non-blank frames at 25 % and 75 % that differ from each other. Screenshots go to debug/app/e2e/.
// Films come from FILMS=a,b (default: every film json in the catalogue folder); results are written to debug/app/e2e/results.json.

const OUT = path.resolve("debug/app/e2e");
const CATALOG_NAME = process.env.CATALOG ?? "catalog";
const CATALOG = path.resolve("web/public/cartoon", CATALOG_NAME);
mkdirSync(OUT, { recursive: true });

const wanted = process.env.FILMS?.split(",");
const films = readdirSync(CATALOG)
  .filter((f) => f.endsWith(".json") && f !== "index.json" && f !== "boards.json")
  .map((file) => ({ id: file.replace(/\.json$/, ""), file }))
  .filter((f) => !wanted || wanted.includes(f.id));

const results: Record<string, unknown> = {};

for (const film of films) {
  test(`${film.id}: parses, converts and plays`, async ({ page }) => {
    // engine/ may not import shared/, so parseAepCompositionSafe runs inside the dev page (a parse failure renders data-testid="error").

    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`/aep-motion.html?src=/cartoon/${CATALOG_NAME}/${film.file}`);
    await page.waitForFunction(() => document.querySelector("canvas") || document.querySelector('[data-testid="error"]'), null, { timeout: 30_000 });
    expect(await page.locator('[data-testid="error"]').count()).toBe(0);
    const ready = await page.evaluate(() => (window as any).__aepMotion.ready());
    expect(ready, "player ready").toBe(true);

    const warnings: string[] = await page.evaluate(() => (window as any).__aepMotion.warnings());
    const skipped = warnings.filter((w) => /skipped|prop dropped|layer dropped/i.test(w));

    const shots: Record<number, string> = {};
    const pngs: Buffer[] = [];
    for (const pct of [25, 75]) {
      await page.evaluate((f) => (window as any).__aepMotion.seekFraction(f), pct / 100);
      await page.waitForTimeout(400);
      const file = path.join(OUT, `${CATALOG_NAME}-${film.id}-${pct}.png`);
      const buf = await page.locator("canvas").first().screenshot({ path: file });
      pngs.push(buf);
      shots[pct] = file;
    }
    // Pixel stats of the two frames, read back through a 2D copy of the screenshot.
    const stats = await page.evaluate(async (b64) => {
      const load = async (s: string) => {
        const img = new Image();
        img.src = "data:image/png;base64," + s;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = 128; c.height = 128;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0, 128, 128);
        return g.getImageData(0, 0, 128, 128).data;
      };
      const a = await load(b64[0]);
      const b = await load(b64[1]);
      const spread = (d: Uint8ClampedArray) => {
        let lo = 255, hi = 0;
        for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; lo = Math.min(lo, l); hi = Math.max(hi, l); }
        return hi - lo;
      };
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) diff++;
      return { spreadA: spread(a), spreadB: spread(b), diffPct: (100 * diff) / (a.length / 4) };
    }, pngs.map((p) => p.toString("base64")));

    results[film.id] = { warnings: warnings.length, skipped: skipped.length, consoleErrors: errors.length, ...stats, shots };
    writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));

    expect(skipped, "skipped warnings").toEqual([]);
    expect(stats.spreadA, "frame 25% not blank").toBeGreaterThan(8);
    expect(stats.spreadB, "frame 75% not blank").toBeGreaterThan(8);
    expect(stats.diffPct, "frames differ").toBeGreaterThan(0.5);
    expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
  });
}
