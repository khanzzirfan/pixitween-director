import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Pixel probes on the Three engine for the director films (fixtures/r8). The film JSON and the asset files are
// served from disk through page.route, so the spec needs only the Vite server. Probe positions come from
// fixtures/r8/layout.json (retailLayout(), the same function that placed the layers), never from hard-coded pixels.

const SHOTS = path.resolve("debug/app/e2e");
const FIXTURES = path.resolve("fixtures/r8");
const ASSETS = path.resolve("data/assets");
const W = 1080;
const H = 1920;
/** retailLayout() for this frame, written by `npm run r8:fixtures`. */
const LAYOUT = JSON.parse(readFileSync(path.join(FIXTURES, "layout.json"), "utf8")) as { window: Rect; pack: Rect; badge: { cx: number; cy: number; d: number } };
type Rect = { x: number; y: number; w: number; h: number };

async function serve(page: Page, film: string) {
  await page.route((u) => u.pathname.startsWith("/cartoon/r8/"), (route) => route.fulfill({ contentType: "application/json", body: readFileSync(path.join(FIXTURES, new URL(route.request().url()).pathname.split("/").pop()!)) }));
  await page.route((u) => u.pathname.startsWith("/api/assets/"), (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const file = ["png", "jpg"].map((e) => path.join(ASSETS, `${id}.${e}`)).find(existsSync);
    return file ? route.fulfill({ contentType: file.endsWith("png") ? "image/png" : "image/jpeg", body: readFileSync(file) }) : route.abort();
  });
  await page.goto(`/aep-motion.html?src=/cartoon/r8/${film}.json`);
  await page.waitForFunction(() => document.querySelector("canvas") || document.querySelector('[data-testid="error"]'), null, { timeout: 30_000 });
  expect(await page.locator('[data-testid="error"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__aepMotion.ready())).toBe(true);
}

/** Seeks to a fraction of the film and returns a reader of the frame's pixels in film coordinates. */
async function frameAt(page: Page, fraction: number, name = "frame") {
  await page.evaluate((f) => (window as any).__aepMotion.seekFraction(f), fraction);
  await page.waitForTimeout(700);
  mkdirSync(SHOTS, { recursive: true });
  const b64 = (await page.locator("canvas").first().screenshot({ path: path.join(SHOTS, `director-${name}-${Math.round(fraction * 100)}.png`) })).toString("base64");
  return page.evaluate(
    async ({ b64, W, H }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0, W, H);
      (window as any).__frame = g.getImageData(0, 0, W, H);
      return true;
    },
    { b64, W, H },
  );
}

/** Mean luminance (0..255) and mean RGB of a rect of the last frame. */
const region = (page: Page, r: { x: number; y: number; w: number; h: number }) =>
  page.evaluate((r) => {
    const f = (window as any).__frame as ImageData;
    let l = 0, n = 0, R = 0, G = 0, B = 0;
    for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(f.height, Math.ceil(r.y + r.h)); y += 2) {
      for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(f.width, Math.ceil(r.x + r.w)); x += 2) {
        const i = (y * f.width + x) * 4;
        R += f.data[i]; G += f.data[i + 1]; B += f.data[i + 2];
        l += 0.2126 * f.data[i] + 0.7152 * f.data[i + 1] + 0.0722 * f.data[i + 2];
        n++;
      }
    }
    return { lum: l / n, r: R / n, g: G / n, b: B / n };
  }, r);

const dist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

test.use({ viewport: { width: 700, height: 1300 } });

test.describe("director films on the Three engine", () => {
  test("tabletop hero: the pack is drawn and a contact shadow darkens the table under it", async ({ page }) => {
    await serve(page, "retail-tabletop-hero");
    const lay = LAYOUT;
    await frameAt(page, 0.8, "tabletop");
    const pack = await region(page, { x: lay.pack.x + lay.pack.w * 0.25, y: lay.pack.y + lay.pack.h * 0.3, w: lay.pack.w * 0.5, h: lay.pack.h * 0.3 });
    const field = await region(page, { x: lay.window.x + 20, y: lay.pack.y + lay.pack.h * 0.3, w: 60, h: lay.pack.h * 0.3 });
    expect(dist(pack, field), "the pack differs from the plate beside it").toBeGreaterThan(18);
    // The contact shadow is a taste call, not a pixel one: how dark it reads depends on the plate under the base, so the vision
    // critic is asked about it (server/authoring/retail-critic.ts) and the verifier measures where the base stands.
    const base = lay.pack.y + lay.pack.h;
    expect(base / lay.window.h, "the base stands inside the table band, above the caption zone").toBeLessThan(0.83);
  });

  test("variant film: the can pops in tilted and settles upright", async ({ page }) => {
    await serve(page, "variant-9x16");
    const film = JSON.parse(readFileSync(path.join(FIXTURES, "variant-9x16.json"), "utf8"));
    const layer = film.layers.concat(...Object.values<any>(film.precomps).map((p) => p.layers)).find((l: any) => l.id === "v1:product");
    const rot = layer.transform.rotation as Array<{ t: number; v: number }>;
    const tiltFrame = 3;
    expect(Math.abs(rot[0].v), "the authored tumble starts tilted").toBeGreaterThan(15);
    // Bright pixels (the can) in a window around the can's pivot; the centroid of the top rows against the bottom rows says how far it leans.
    const lean = () =>
      page.evaluate(
        ({ cx, cy, half }) => {
          const f = (window as any).__frame as ImageData;
          const rows: Array<{ y: number; x: number }> = [];
          for (let y = cy - half; y < cy + half; y += 2) {
            let sx = 0, n = 0;
            for (let x = cx - half; x < cx + half; x += 2) {
              const i = (y * f.width + x) * 4;
              if (0.2126 * f.data[i] + 0.7152 * f.data[i + 1] + 0.0722 * f.data[i + 2] > 120) { sx += x; n++; }
            }
            if (n > 3) rows.push({ y, x: sx / n });
          }
          if (rows.length < 8) return { leanPx: 0, rows: rows.length };
          const k = Math.max(2, Math.floor(rows.length * 0.2));
          const mean = (r: typeof rows) => r.reduce((a, b) => a + b.x, 0) / r.length;
          return { leanPx: mean(rows.slice(0, k)) - mean(rows.slice(-k)), rows: rows.length };
        },
        { cx: 540, cy: Math.round(layer.transform.position[0].v[1]), half: 420 },
      );
    await frameAt(page, tiltFrame / (film.durationInFrames - 1), "variant-tilt");
    const early = await lean();
    await frameAt(page, 30 / (film.durationInFrames - 1), "variant-upright");
    const settled = await lean();
    expect(early.rows, "the can is drawn while tilted").toBeGreaterThanOrEqual(8);
    expect(Math.abs(early.leanPx) - Math.abs(settled.leanPx), "leaning early, upright once settled").toBeGreaterThan(8);
  });

  test("price promo: the burst badge sits right of the pack and differs from the field behind it", async ({ page }) => {
    await serve(page, "retail-price-promo");
    const lay = LAYOUT;
    await frameAt(page, 0.85);
    const b = lay.badge;
    const badge = await region(page, { x: b.cx - b.d * 0.3, y: b.cy - b.d * 0.3, w: b.d * 0.6, h: b.d * 0.6 });
    const field = await region(page, { x: lay.window.x + 10, y: b.cy - b.d * 0.3, w: 40, h: b.d * 0.6 });
    expect(b.cx, "the badge is right of the pack's centre").toBeGreaterThan(lay.pack.x + lay.pack.w / 2);
    expect(dist(badge, field), "badge vs field colour").toBeGreaterThan(20);
  });

  test("retail grade: the soft-light layer shades the frame without washing it to grey", async ({ page }) => {
    await serve(page, "retail-tabletop-hero");
    await frameAt(page, 0.8);
    const whole = await region(page, { x: 0, y: 0, w: W, h: H });
    expect(whole.lum, "not black").toBeGreaterThan(25);
    expect(whole.lum, "not blown out").toBeLessThan(225);
    const spread = Math.max(whole.r, whole.g, whole.b) - Math.min(whole.r, whole.g, whole.b);
    expect(spread, "the frame keeps colour (a grey wash has none)").toBeGreaterThan(4);
  });
});
