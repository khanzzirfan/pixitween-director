import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Measurement run for engine/docs/07-text3d-findings.md. Drives /motion-text3d-lab.html, writes every raw
// number to debug/engine/text3d-measurements.json and the screenshots the findings name.

const DEBUG_DIR = path.resolve("debug/engine");
mkdirSync(DEBUG_DIR, { recursive: true });
test.setTimeout(900_000);

const BASE = "The quick brown fox jumps over the lazy dog ";
function textOf(n: number, salt: number): string {
  // Exactly n characters (the schema caps text at 200 including newlines): lines of 19 letters + "\n".
  const pool = BASE.repeat(20).replace(/ /g, "");
  let out = "";
  let i = salt;
  while (out.length < n) {
    const line = pool.slice(i, i + 19);
    i += 19;
    out += out.length + 20 <= n ? line + "\n" : line.slice(0, n - out.length);
  }
  return out;
}

async function setText(page: Page, text: string) {
  await page.evaluate(() => {
    (window as any).__prev = (window as any).__text3dLab.stats();
  });
  await page.getByLabel("Text").fill(text);
  await page.waitForFunction(() => {
    const s = (window as any).__text3dLab.stats();
    return s && s !== (window as any).__prev;
  }, null, { timeout: 30_000 });
}

async function rebuild(page: Page, change: () => Promise<void>) {
  await page.evaluate(() => {
    (window as any).__prev = (window as any).__text3dLab.stats();
  });
  await change();
  await page.waitForFunction(() => {
    const s = (window as any).__text3dLab.stats();
    return s && s !== (window as any).__prev;
  }, null, { timeout: 30_000 });
}

const stats = (page: Page) => page.evaluate(() => ({ ...(window as any).__text3dLab.stats() }));

async function setDepth(page: Page, depth: number, bevel: boolean, cs: number) {
  await page.getByLabel("Depth").fill(String(depth));
  await page.getByLabel("Bevel").setChecked(bevel);
  await page.getByLabel("Curve segments").fill(String(cs));
}

async function frameMs(page: Page): Promise<number> {
  // Wait for 60 fresh gaps' worth of time, then read the average.
  await page.waitForTimeout(6000);
  const t = await page.getByTestId("frameMs").textContent();
  return Number(t);
}

test("measure", async ({ page }) => {
  const out: any = { builds: [], frames: [], disposal: null };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/motion-text3d-lab.html");
  await expect(page.getByTestId("glyphCount")).toHaveText("17");
  out.env = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") as WebGL2RenderingContext;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      ua: navigator.userAgent,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      cores: navigator.hardwareConcurrency,
    };
  });

  // Build cost: steady state, no animation presets so only the build is exercised.
  await page.getByLabel("Enter").selectOption("none");
  await page.getByLabel("Loop").selectOption("none");
  const configs = [
    { name: "flat", depth: 0, bevel: false, cs: 8 },
    { name: "d0.2-bevel-cs8", depth: 0.2, bevel: true, cs: 8 },
    { name: "d0.2-bevel-cs16", depth: 0.2, bevel: true, cs: 16 },
  ];
  for (const cfg of configs) {
    await rebuild(page, () => setDepth(page, cfg.depth, cfg.bevel, cfg.cs));
    for (const n of [20, 80, 200]) {
      for (let run = 0; run < 3; run++) {
        await setText(page, textOf(n, run + 1));
        const s = await stats(page);
        out.builds.push({ config: cfg.name, chars: n, run: run + 1, ...s });
      }
    }
  }

  // Frame time: depth 0.2 + bevel + cs 8 while glyphPop / glyphWave play.
  await rebuild(page, () => setDepth(page, 0.2, true, 8));
  await page.getByLabel("Stagger each").fill("0.01");
  for (const preset of ["glyphPop", "glyphWave"]) {
    for (const n of [20, 80, 200]) {
      for (let run = 0; run < 3; run++) {
        await rebuild(page, async () => {
          if (preset === "glyphPop") {
            await page.getByLabel("Loop").selectOption("none");
            await page.getByLabel("Enter").selectOption("glyphPop");
          } else {
            await page.getByLabel("Enter").selectOption("none");
            await page.getByLabel("Loop").selectOption("glyphWave");
          }
          await page.getByLabel("Text").fill(textOf(n, run + 1));
        });
        const s = await stats(page);
        const ms = await frameMs(page);
        out.frames.push({ preset, chars: n, run: run + 1, frameMs: ms, triangles: s.triangles, buildMs: s.buildMs });
      }
    }
  }

  // Disposal: renderer.info.memory around load / unload / destroy.
  out.disposal = await page.evaluate(async () => {
    const h = (window as any).__text3dLab.handle;
    const rt = h.getRuntime();
    const info = rt.getRenderer().info;
    const read = () => ({ geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? null });
    const settle = async () => { await rt.whenReady(10); rt.seek(rt.getTime()); await new Promise((r) => setTimeout(r, 400)); };
    const empty = {
      version: 1, width: 640, height: 360, fps: 30, duration: 2, background: "#000000",
      layers: [{ id: "s", type: "shape", shape: "rect", x: 320, y: 180, width: 100, height: 100, fill: "#ffffff" }],
    };
    const textDoc = (n: number, curve: number) => ({
      version: 1, width: 1920, height: 1080, fps: 30, duration: 6, background: "#0b0f14",
      assets: { face: { type: "font", url: "/fonts/helvetiker_bold.typeface.json" } },
      layers: [{ id: "stage", type: "three", x: 960, y: 540, width: 1800, height: 1000, background: "#0b0f14",
        lighting: { preset: "studio" }, shadow: { enabled: true },
        camera: { position: [0, 0, 8], lookAt: [0, 0, 0], fov: 32 },
        objects: [{ id: "title", geometry: { type: "text3d", font: "face", text: "Fresh every\nmorning", size: 0.7, depth: 0.25, curveSegments: curve, align: "center", bevel: {} },
          position: [0, 0, 0], material: { color: "#ffd27a" } }], end: 6 }],
    });
    const res: any = {};
    h.pause();
    await rt.load(empty); await settle();
    res.before = read();
    await rt.load(textDoc(0, 8)); await settle();
    res.during = read();
    res.duringStats = { ...(window as any).__text3dLab.stats() };
    await rt.load(textDoc(0, 8)); await settle();
    res.afterReload = read();
    await rt.load(empty); await settle();
    res.afterUnload = read();
    await rt.load(textDoc(0, 8)); await settle();
    res.duringAgain = read();
    rt.destroy();
    res.afterDestroy = read();
    return res;
  });
  writeFileSync(path.join(DEBUG_DIR, "text3d-measurements.json"), JSON.stringify(out, null, 2));
  console.log("ERRORS", JSON.stringify(errors));
});

test("stills", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/motion-text3d-lab.html");
  await expect(page.getByTestId("glyphCount")).toHaveText("17");
  // Camera raised and text lifted above the shadow catcher (y 0), otherwise the catcher is edge-on.
  const still = async (name: string, lighting: string, depth: number, shadow: boolean) => {
    await page.evaluate(async ({ lighting, depth, shadow }) => {
      const h = (window as any).__text3dLab.handle;
      const rt = h.getRuntime();
      h.pause();
      const r = await rt.load({
        version: 1, width: 1920, height: 1080, fps: 30, duration: 6, background: "#c9ced6",
        assets: { face: { type: "font", url: "/fonts/helvetiker_bold.typeface.json" } },
        layers: [{ id: "stage", type: "three", x: 960, y: 540, width: 1800, height: 1000, background: "#c9ced6",
          lighting: { preset: lighting }, shadow: { enabled: shadow, opacity: 0.6, y: 0 },
          camera: { position: [0, 2.2, 7], lookAt: [0, 0.6, 0], fov: 32 },
          objects: [{ id: "title", geometry: { type: "text3d", font: "face", text: "Fresh every morning", size: 0.45, depth, curveSegments: 8, align: "center", ...(depth > 0 ? { bevel: {} } : {}) },
            position: [0, 0.9, 0], material: { color: "#d4890a", roughness: 0.3, metalness: 0.2 } }], end: 6 }],
      });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      rt.seek(3);
      await rt.whenReady(10);
    }, { lighting, depth, shadow });
    await page.waitForTimeout(800);
    await page.locator("canvas").first().screenshot({ path: path.join(DEBUG_DIR, `${name}.png`) });
  };
  await still("text3d-shadow-studio-d0", "studio", 0, true);
  await still("text3d-shadow-studio-d02", "studio", 0.2, true);
  await still("text3d-shadow-golden-d0", "golden", 0, true);
  await still("text3d-shadow-golden-d02", "golden", 0.2, true);
  await still("text3d-noshadow-studio-d02", "studio", 0.2, false);

  // Same sentence as the 2D text layer, through the same runtime.
  await page.evaluate(async () => {
    const h = (window as any).__text3dLab.handle;
    const rt = h.getRuntime();
    const r = await rt.load({
      version: 1, width: 1920, height: 1080, fps: 30, duration: 6, background: "#0b0f14",
      layers: [{ id: "t2d", type: "text", x: 960, y: 540, text: "Fresh every morning",
        style: { fontFamily: "Helvetica, Arial, sans-serif", fontSize: 150, fontWeight: "bold", fill: "#ffd27a", align: "center",
          dropShadow: { color: "#000000", alpha: 0.5, blur: 6, distance: 8, angle: 45 } } }],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    rt.seek(3);
    await rt.whenReady(10);
  });
  await page.waitForTimeout(500);
  await page.locator("canvas").first().screenshot({ path: path.join(DEBUG_DIR, "text3d-vs-2d-text-layer.png") });

});
