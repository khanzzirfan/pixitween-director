import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Every fixture in engine/fixtures/, driven headless through /motion-lab.html's window.__motion
// test hooks (engine/docs/06-runtime-player.md, "End-to-end"): readiness, deterministic seeks,
// a motion check (seeking actually changes the picture), a colour check and a transparency check.

const DEBUG_DIR = path.resolve("debug/engine");

const FIXTURE_NAMES = [
  "basic-2d",
  "camera-moves",
  "effects-2d",
  "polystar",
  "soft-light",
  "three-gltf",
  "three-postfx",
  "three-primitives",
  "three-text",
  "showcase-product-turntable",
  "showcase-title-card",
  "showcase-robot-dance",
];

mkdirSync(DEBUG_DIR, { recursive: true });

type Motion = {
  handle: {
    getDuration(): number;
    seek(sec: number): void;
    getCanvas(): HTMLCanvasElement;
  };
  ready(): Promise<boolean>;
  hash(): Promise<string>;
  pixel(x: number, y: number): [number, number, number, number];
  errors(): string[];
  capture(kind: "frame" | "sheet" | "depth" | "normal"): Promise<Blob | null>;
};

declare global {
  interface Window {
    __motion: Motion;
  }
}

async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto(`/motion-lab.html?doc=${name}`);
  await page.waitForFunction(() => Boolean(window.__motion));
}

// Full-resolution (not the lab's own 64x36 downscale) so a subtle loop still flips the hash.
async function seekAndHash(page: Page, fraction: number): Promise<string> {
  await page.evaluate((f) => {
    const duration = window.__motion.handle.getDuration();
    window.__motion.handle.seek(duration * f);
  }, fraction);
  return hashNow(page);
}

/** The SHA-256 of the canvas as it stands, at full resolution. */
async function hashNow(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const data = window.__motion.handle.getCanvas().toDataURL("image/png");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(data),
    );
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
}

for (const name of FIXTURE_NAMES) {
  test(`${name}: readiness, determinism and motion`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on(
      "console",
      (m) => m.type() === "error" && consoleErrors.push(m.text()),
    );
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    await openFixture(page, name);

    const ready = await page.evaluate(() => window.__motion.ready());
    expect(ready).toBe(true);
    expect(await page.evaluate(() => window.__motion.errors())).toEqual([]);

    const hash40First = await seekAndHash(page, 0.4);
    await seekAndHash(page, 0);
    const hash40Second = await seekAndHash(page, 0.4);
    expect(hash40Second).toBe(hash40First);

    const hash80 = await seekAndHash(page, 0.8);
    expect(hash80).not.toBe(hash40Second);

    expect(consoleErrors.filter((e) => !/favicon/i.test(e))).toEqual([]);

    await page.screenshot({ path: path.join(DEBUG_DIR, `${name}-40.png`) });

    if (name === "three-text") {
      for (const pct of [25, 50, 90]) {
        await seekAndHash(page, pct / 100);
        await page
          .locator("canvas")
          .first()
          .screenshot({ path: path.join(DEBUG_DIR, `${name}-${pct}.png`) });
      }
    }

    if (name.startsWith("showcase-")) {
      for (const pct of [25, 50, 75]) {
        await seekAndHash(page, pct / 100);
        await page
          .locator("canvas")
          .first()
          .screenshot({ path: path.join(DEBUG_DIR, `${name}-${pct}.png`) });
      }
    }
  });
}

test("basic-2d: the #ff0000 badge renders red at its centre", async ({
  page,
}) => {
  await openFixture(page, "basic-2d");
  await page.evaluate(() => window.__motion.ready());
  // badge: ellipse, fill #ff0000, centred at (300, 320); seek past its enter (zoomIn) so it's fully shown.
  await page.evaluate(() => window.__motion.handle.seek(2));
  const [r, g, b] = await page.evaluate(() => window.__motion.pixel(300, 320));
  expect(r).toBeGreaterThanOrEqual(254);
  expect(g).toBeLessThanOrEqual(1);
  expect(b).toBeLessThanOrEqual(1);
});

test("polystar: the 16-point star draws with points, and the 6-point polygon fills", async ({
  page,
}) => {
  await openFixture(page, "polystar");
  expect(await page.evaluate(() => window.__motion.ready())).toBe(true);
  expect(await page.evaluate(() => window.__motion.errors())).toEqual([]);

  // The star sits at (700, 540) with an outer radius of 220 and an inner radius of 95. A tip
  // points straight up, and the inner corners sit half a tip (11.25 degrees) to the side of it,
  // so the ray towards an inner corner leaves the star long before the ray towards a tip does.
  const star = await page.evaluate(() => {
    const reach = 220 * 0.6;
    return {
      centre: window.__motion.pixel(700, 540),
      tip: window.__motion.pixel(700, Math.round(540 - reach)),
      valley: window.__motion.pixel(
        Math.round(700 + reach * Math.sin(Math.PI / 16)),
        Math.round(540 - reach * Math.cos(Math.PI / 16)),
      ),
    };
  });

  // The star is filled white, and the ray towards an inner corner has already left it.
  expect(star.centre[0], "the star's centre is white").toBeGreaterThan(240);
  expect(star.tip[0], "the star is filled towards its tip").toBeGreaterThan(240);
  expect(star.valley[0], "the star ends before its inner corner").toBeLessThan(80);

  // The polygon is filled with its own colour.
  const polygon = await page.evaluate(() => window.__motion.pixel(1250, 540));
  expect(polygon[2], "the polygon is blue").toBeGreaterThan(200);
  expect(polygon[0], "the polygon is blue").toBeLessThan(120);

  await page
    .locator("canvas")
    .first()
    .screenshot({ path: path.join(DEBUG_DIR, "polystar.png") });
});

test("soft-light: a white layer at half opacity leaves the plate where it is, and a normal one washes it out", async ({
  page,
}) => {
  await openFixture(page, "soft-light");
  expect(await page.evaluate(() => window.__motion.ready())).toBe(true);
  expect(await page.evaluate(() => window.__motion.errors())).toEqual([]);

  // Both halves of the fixture are the same mid-grey plate (#808080) with a white full-frame
  // layer at half opacity over it. The left one blends soft-light, the right one blends normal.
  const soft = await page.evaluate(() => window.__motion.pixel(240, 200));
  const normal = await page.evaluate(() => window.__motion.pixel(1680, 200));

  // Soft light at 0.5 is the identity, so the plate stays where it was: within 3 % of 128.
  expect(Math.abs(soft[0] - 128), "the soft-light plate is unchanged").toBeLessThanOrEqual(3);
  expect(Math.abs(soft[1] - 128)).toBeLessThanOrEqual(3);
  expect(Math.abs(soft[2] - 128)).toBeLessThanOrEqual(3);

  // A normal blend at half opacity washes the plate out: it reads as the mix of grey and white.
  expect(normal[0], "the normal plate is washed out").toBeGreaterThan(180);

  await page
    .locator("canvas")
    .first()
    .screenshot({ path: path.join(DEBUG_DIR, "soft-light.png") });
});

test("three-postfx: a corner of the hero layer stays the plate colour through the tweened bloom/vignette", async ({
  page,
}) => {
  await openFixture(page, "three-postfx");
  await page.evaluate(() => window.__motion.ready());
  // hero: three layer at x=960,y=540,w=1600,h=1080 → spans x∈[160,1760], y∈[0,1080]. The can sits centred;
  // a point near the layer's top-left corner has no 3D content, so it's transparent there and the plate
  // (bg layer, behind it) must show through unaffected by the hero's own post-fx chain. Since bloom/vignette
  // are tweened across the whole duration, sampling that same point at two very different times and finding
  // it unchanged proves the effect only touches the non-transparent (3D) area, not the plate behind it.
  const point = [200, 60] as const;
  await page.evaluate(() => window.__motion.handle.seek(0.2));
  const early = await page.evaluate((p) => window.__motion.pixel(...p), point);
  await page.evaluate(() => window.__motion.handle.seek(6.5));
  const late = await page.evaluate((p) => window.__motion.pixel(...p), point);
  expect(Math.abs(early[0] - late[0])).toBeLessThanOrEqual(2);
  expect(Math.abs(early[1] - late[1])).toBeLessThanOrEqual(2);
  expect(Math.abs(early[2] - late[2])).toBeLessThanOrEqual(2);
});

// The camera reel (engine/fixtures/camera-moves.json): one chapter per shot size and per camera
// preset, then a camera path. The chapter times are the fixture's own timeline.
const CAMERA_SHOTS: Array<{ id: string; at: number }> = [
  { id: "shot-extreme-wide", at: 0.6 },
  { id: "shot-wide", at: 1.8 },
  { id: "shot-medium", at: 3.0 },
  { id: "shot-close-up", at: 4.2 },
  { id: "shot-extreme-close-up", at: 5.4 },
];

const CAMERA_MOVES: Array<{ id: string; from: number; to: number }> = [
  { id: "move-camera-to", from: 6.0, to: 7.5 },
  { id: "move-orbit", from: 8.5, to: 10.0 },
  { id: "move-crane", from: 11.5, to: 13.5 },
  { id: "move-dolly-zoom", from: 14.5, to: 16.0 },
  { id: "move-handheld", from: 16.5, to: 17.0 },
  { id: "move-path", from: 18.5, to: 19.5 },
];

test("camera-moves: the shot ladder frames tighter and tighter, and every camera preset moves the camera", async ({
  page,
}) => {
  await openFixture(page, "camera-moves");
  await page.evaluate(() => window.__motion.ready());

  const centre = async (at: number) => {
    await page.evaluate((t) => window.__motion.handle.seek(t), at);
    return page.evaluate(() => window.__motion.pixel(960, 540));
  };

  // The extreme wide keeps the robot tiny, so the middle of the frame is still the backdrop.
  const wide = await centre(CAMERA_SHOTS[0].at);
  expect(
    wide[1],
    "the extreme wide shows the backdrop at the centre",
  ).toBeGreaterThan(wide[0]);
  expect(wide[1]).toBeGreaterThan(wide[2]);

  // The close-up frames the robot's head, which is cyan.
  const closeUp = await centre(CAMERA_SHOTS[3].at);
  expect(
    closeUp[2],
    "the close-up shows the cyan head at the centre",
  ).toBeGreaterThan(closeUp[0] + 30);

  // The extreme close-up is the dark visor, filling the frame.
  const extremeCloseUp = await centre(CAMERA_SHOTS[4].at);
  expect(
    Math.max(...extremeCloseUp.slice(0, 3)),
    "the extreme close-up is the dark visor",
  ).toBeLessThan(90);

  // Every camera preset really moves the camera: the picture changes while its chapter plays.
  for (const move of CAMERA_MOVES) {
    await page.evaluate((t) => window.__motion.handle.seek(t), move.from);
    const before = await hashNow(page);
    await page.evaluate((t) => window.__motion.handle.seek(t), move.to);
    const after = await hashNow(page);
    expect(after, `${move.id} does not move the camera`).not.toBe(before);
  }

  // One screenshot per chapter, so the lab page can be judged by eye.
  for (const chapter of [...CAMERA_SHOTS, ...CAMERA_MOVES]) {
    const at = "at" in chapter ? chapter.at : chapter.to;
    await page.evaluate((t) => window.__motion.handle.seek(t), at);
    await page
      .locator("canvas")
      .first()
      .screenshot({
        path: path.join(DEBUG_DIR, `camera-moves-${chapter.id}.png`),
      });
  }
});

/** Runs a lab capture button's function and returns the PNG as base64 plus its pixel size. */
async function capturePng(page: Page, kind: "frame" | "sheet" | "depth" | "normal") {
  return page.evaluate(async (k) => {
    const blob = await window.__motion.capture(k);
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return { b64: btoa(bin), width: bmp.width, height: bmp.height };
  }, kind);
}

test("three-gltf: contact sheet grid, depth and normal passes, canvas restored", async ({ page }) => {
  await openFixture(page, "three-gltf");
  expect(await page.evaluate(() => window.__motion.ready())).toBe(true);
  await page.evaluate(() => window.__motion.handle.seek(2));
  const before = await hashNow(page);

  const sheet = await capturePng(page, "sheet");
  expect(sheet).not.toBeNull();
  // 4 columns x 3 rows: cell 320 wide, 16:9 cell 180 + 22 label.
  expect(sheet!.width).toBe(1280);
  expect(sheet!.height).toBe(3 * (180 + 22));
  writeFileSync(path.join(DEBUG_DIR, "three-gltf-contact-sheet.png"), Buffer.from(sheet!.b64, "base64"));
  expect(await hashNow(page)).toBe(before);

  const depth = await capturePng(page, "depth");
  writeFileSync(path.join(DEBUG_DIR, "three-gltf-depth.png"), Buffer.from(depth!.b64, "base64"));
  expect(await hashNow(page)).toBe(before);

  const normal = await capturePng(page, "normal");
  writeFileSync(path.join(DEBUG_DIR, "three-gltf-normal.png"), Buffer.from(normal!.b64, "base64"));
  expect(await hashNow(page)).toBe(before);

  const frame = await capturePng(page, "frame");
  writeFileSync(path.join(DEBUG_DIR, "three-gltf-frame.png"), Buffer.from(frame!.b64, "base64"));
  expect(await hashNow(page)).toBe(before);
});

test("three-postfx: export pack button downloads 7 files and lists them in notes", async ({ page }) => {
  await openFixture(page, "three-postfx");
  expect(await page.evaluate(() => window.__motion.ready())).toBe(true);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.getByRole("button", { name: "Export pack" }).click();
  await expect(page.getByTestId("notes")).toContainText("Exported 7 files", { timeout: 60_000 });
  await page.waitForTimeout(500);
  expect(downloads.sort()).toEqual([
    "three-postfx-camera.json",
    "three-postfx-contact-sheet.png",
    "three-postfx-depth.png",
    "three-postfx-first.png",
    "three-postfx-last.png",
    "three-postfx-normal.png",
    "three-postfx-summary.txt",
  ]);
  const notes = await page.getByTestId("notes").innerText();
  for (const n of downloads) expect(notes).toContain(n);
  await page.screenshot({ path: path.join(DEBUG_DIR, "three-postfx-export-pack.png") });
});
