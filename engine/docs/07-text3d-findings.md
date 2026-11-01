# 3D text: measured findings

Design: [07-text3d.md](07-text3d.md). Every number below was measured by `engine/e2e/text3d-measure.spec.ts`
(drives `/motion-text3d-lab.html`); raw values are in `debug/engine/text3d-measurements.json`.
Re-run: `npx playwright test -c engine/playwright.config.ts text3d-measure`.

## Machine and browser

- Apple M4 Max (14 logical cores), macOS, Playwright headless Chromium 156.
- WebGL is **software**: `ANGLE (Vulkan, SwiftShader Device, LLVM 10.0.0)`. The user agent reports Windows (headless spoof).
  **Frame times are therefore CPU rasterisation numbers, much slower than a real GPU.** Compare rows with each
  other, do not read them as end-user frame rates. Build time and triangle counts do not depend on the GPU.
- Font: `helvetiker_bold.typeface.json`, size 0.7, bold, studio lighting, shadows on, 1920x1080 stage shown at 720 px wide.

## How the strings were made

The schema caps `text` at 200 characters *including newlines*, so "N characters" is a string of exactly N
characters made of lines of 19 letters plus `\n`. Real glyph counts: **20 -> 19, 80 -> 76, 200 -> 190**.
Each run used a different slice of the same pangram pool, so the three runs differ slightly in letters
(hence slightly different triangle counts). Letters only, no spaces.

## Measurements: build time and triangles

Build time is `stats.buildMs` (layout + geometry + meshes for the whole text). Three runs, median in bold.
Triangles are from `stats.triangles`. "Depth 0.2" always includes bevel.

| Config | Chars (glyphs) | Build ms, runs 1/2/3 | Build ms median | Triangles, runs 1/2/3 | Triangles median | Unique geometries 1/2/3 |
|---|---|---|---|---|---|---|
| flat (depth 0, no bevel, curveSegments 8) | 20 (19) | 2.0 / 2.3 / 1.6 | **2.0** | 5988 / 6412 / 6432 | **6412** | 17 / 17 / 16 |
| flat | 80 (76) | 3.5 / 2.9 / 3.1 | **3.1** | 26004 / 25764 / 25804 | **25804** | 27 / 27 / 27 |
| flat | 200 (190) | 3.5 / 3.2 / 3.4 | **3.4** | 64220 / 64096 / 63888 | **64096** | 27 / 27 / 27 |
| depth 0.2, bevel, curveSegments 8 | 20 (19) | 3.8 / 3.3 / 3.8 | **3.8** | 18084 / 19356 / 19416 | **19356** | 17 / 17 / 16 |
| depth 0.2, bevel, cs 8 | 80 (76) | 5.6 / 6.2 / 6.1 | **6.1** | 78436 / 77716 / 77836 | **77836** | 27 / 27 / 27 |
| depth 0.2, bevel, cs 8 | 200 (190) | 6.1 / 6.2 / 7.7 | **6.2** | 193708 / 193344 / 192728 | **193344** | 27 / 27 / 27 |
| depth 0.2, bevel, curveSegments 16 | 20 (19) | 6.5 / 6.8 / 5.8 | **6.5** | 34596 / 37212 / 37368 | **37212** | 17 / 17 / 16 |
| depth 0.2, bevel, cs 16 | 80 (76) | 10.5 / 10.0 / 10.0 | **10.0** | 151396 / 149908 / 150124 | **150124** | 27 / 27 / 27 |
| depth 0.2, bevel, cs 16 | 200 (190) | 10.0 / 11.5 / 10.4 | **10.4** | 373516 / 372768 / 371480 | **372768** | 27 / 27 / 27 |

(Build times are rounded to 0.1 ms from the raw `buildMs` values.)

Reading: building is cheap, about 2 to 10 ms even for 190 glyphs, because geometry is built once per distinct
character. Triangles are the real cost: bevel plus depth is about 3x flat, and doubling curveSegments about
doubles triangles again. A 200-character bevelled block is ~190k to ~370k triangles.

## Measurements: frame time while playing

Average gap between animation frames over the last 60 frames (lab "avg frame time"), read after 6 s of play.
Depth 0.2, bevel, curveSegments 8, shadows on, stagger 0.01 s. **Software GL (see above).**

| Preset | Chars (glyphs) | Triangles (median) | Frame ms, runs 1/2/3 | Frame ms median |
|---|---|---|---|---|
| glyphPop | 20 (19) | 19356 | 35.1 / 34.4 / 34.4 | **34.4** |
| glyphPop | 80 (76) | 77836 | 60.9 / 57.5 / 59.5 | **59.5** |
| glyphPop | 200 (190) | 193344 | 79.1 / 80.6 / 83.1 | **80.6** |
| glyphWave | 20 (19) | 19356 | 36.2 / 36.2 / 37.4 | **36.2** |
| glyphWave | 80 (76) | 77836 | 61.1 / 59.0 / 68.2 | **61.1** |
| glyphWave | 200 (190) | 193344 | 78.1 / 80.7 / 80.3 | **80.3** |

Reading: frame time grows with triangle count, not with the preset (pop and wave match within noise). On this
software renderer even 19 glyphs is ~35 ms, so these numbers say nothing about 60 fps on a GPU.
**Smoothness on real hardware was not measured** (see "Not measured").

## Geometry sharing

`uniqueGeometries` equals the number of distinct characters, not glyphs: 17 / 17 / 16 for 19 glyphs, and 27 for
both 76 and 190 glyphs (the pool uses 27 distinct letters). Sharing works. Triangles still count every glyph.
Every glyph has its own material clone.

## Disposal

`renderer.info.memory` read from the runtime's renderer, after rendering each state (headless run, the lab's
"Fresh every\nmorning" text, depth 0.25, bevel). The baseline document has one 2D rect shape layer, so the
starting value is not zero.

| State | geometries | textures |
|---|---|---|
| Before (rect-only doc loaded) | 1 | 2 |
| During (text doc loaded, 17 glyphs, 12 unique) | 15 | 7 |
| Loaded again (same doc reloaded) | 15 | 7 |
| After unloading (rect-only doc loaded again) | 1 | 2 |
| During again | 15 | 7 |
| After `runtime.destroy()` | 0 | 2 |

- Geometries returned to the starting value (1) after unloading the text doc. The text added 14 geometries, not the 12
  unique glyph geometries only; the other 2 are not text (the shadow catcher plane and the stage plane/render target quad), which were
  not separated out and are an inference.
- Reloading the same doc did not leak: 15 before and after.
- After `destroy()` geometries went to 0, i.e. below the starting 1, because destroy also disposes the rect layer's own geometry. Textures stayed at 2 after destroy.
  The 2 textures are not attributed to anything; that remaining value was not investigated.

## Shadows and the 2D comparison

Screenshots in `debug/engine/` (light grey background so a shadow would show; camera raised, text lifted above the
catcher at y 0, shadow opacity 0.6, size 0.45, "Fresh every morning", paused at 3 s):

- `text3d-shadow-studio-d0.png`, `text3d-shadow-studio-d02.png`, `text3d-shadow-golden-d0.png`,
  `text3d-shadow-golden-d02.png`, `text3d-noshadow-studio-d02.png`.
- Observed: with depth 0.2 the letters show self-shadowing, dark bands on the faces and sides (visible on "Fresh"
  and "morning"), in both studio and golden. At depth 0 the text is flat and shows no shading or shadow.
  A pixel diff of `text3d-shadow-studio-d02.png` against `text3d-noshadow-studio-d02.png` shows differences only inside the
  text's bounding box (x 76 to 643, y 147 to 206): turning the shadow on changes the letters, not the floor.
- **No cast shadow was visible on the shadow-catcher plane** in this framing, in either preset. The cause was not
  investigated (it may be the light direction throwing the shadow behind the text or out of the catcher's extent); so
  "shadows look right" is not confirmed for floor shadows, only for self-shadowing.
- 2D comparison: `text3d-vs-2d-text-layer.png` is the same sentence as a 2D `text` layer (bold Helvetica/Arial, 150 px, drop shadow).
  The 2D layer is sharp, flat, a perfectly regular edge, and its lines are laid out with native font kerning and
  wrapping. The 3D text has real depth and lighting and its glyphs can be animated one by one in 3D (rotate, pop in z).

## Not supported (3D text)

- Kerning pairs (placement uses each glyph's advance only).
- Ligatures.
- Right-to-left text and complex scripts (Arabic, Indic, etc.); one glyph per character, left to right.
- Automatic word wrap (lines break only at `\n`).
- Text longer than 200 characters (schema limit), and no per-glyph fonts or styles inside one object.
- Only characters present in the typeface.json (helvetiker: basic Latin); others are skipped with a warning.

## What MSDF would add (from reading only)

Read from `tmp/reacthub-pixitweenjs/src/components/AepComposition/AepMsdfTextMesh.tsx` and `utils/msdf/` (no new
dependency, nothing run here). That code draws every glyph as a quad in **one `InstancedMesh`** (one draw call for
all glyphs, capacity grown to a power of two) with a shared atlas texture and a shader that takes the median of
the three channels to get a distance and a per-pixel edge width, so edges stay crisp at any zoom. Per-glyph UV
rect and colour are instance attributes. It handles layout through the AEP text layout hook (which covers
wrapping, tracking and animators), and filters whitespace. So MSDF adds: flat text that is crisp at any scale, one
draw call and a constant tiny triangle count (2 per glyph, vs ~1000 here), cheap animation of many glyphs, and
real layout. It does not give depth, bevel or lighting.

## Recommendation

- **3D text** (this implementation): short headlines and logos, roughly up to 20 to 80 glyphs, where depth, lighting,
  bevel and glyph-by-glyph 3D motion are the point. Keep depth/bevel modest: flat is about a third of the triangles, and
  curveSegments 8 is half of 16. Build time is not a concern; triangle count is.
- **2D text layer**: anything else: body text, captions, long or wrapped text, non-Latin scripts, text that
  needs kerning or exact typography.
- **MSDF later**: if we need many animated 2D-looking glyphs inside the 3D scene (kinetic typography, hundreds of characters) or crisp
  text at any zoom with one draw call. Not needed for the headline use case.
- Before relying on 3D text for 100+ glyphs, measure on a real GPU (this machine's run was software GL).

## Not measured

- Frame time on a hardware GPU: the headless run used software GL (SwiftShader). Frame times are not representative of user devices.
- Cast shadow on the shadow-catcher floor: not observed in the framing tried, cause not investigated.
- The attribution of the 2 non-text geometries and the 2 leftover textures in the disposal table.
- "Same pixels forwards and backwards" with staggered presets is covered by the US-002 determinism check, not re-measured here.
- 200 characters means 190 glyphs, because the schema limit counts newlines (stated above).

## .ttf fonts (US-004 spike)

Spike: `debug/engine/ttf-spike.mjs` (three `TTFLoader.parse` then `FontLoader.parse`, on `web/public/fonts/kenpixel.ttf`).
Output, quoted:

```
OK web/public/fonts/kenpixel.ttf: glyphs=135 fontGlyphs=135 time=2.9ms
```

**.ttf support was kept.** It worked with no new dependency (TTFLoader ships with three and bundles opentype.js), so
`loadFont` in `engine/src/three/text/font.ts` now picks TTFLoader when the url ends in `.ttf` (query/hash allowed) and
reads `response.arrayBuffer()`; other urls parse JSON as before. Unit test covers both paths with an injected fetch.
Caveats: only one font tried (kenpixel, a simple pixel font); not checked in the browser or with
kerning/ligature fonts (still unsupported); the bundle grows by opentype.js, not measured.
