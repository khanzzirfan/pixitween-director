# 07. 3D text with per-glyph animation (extension, phase T)

An extension to the engine, built by two PRDs (`ralph/prd-t1-text3d-core.json`, then `ralph/prd-t2-text3d-lab.json`) **after** the Three-only engine is done
(R1 to R4 and M8 passed). It only adds: it changes no behaviour of existing docs. Where it edits an existing file, the PRD
lists it under `sharedEdits`.

## Why this design (reasoning)

Options we looked at (web search + the library's `Aep3DTextMesh.tsx`, `AepMsdfTextMesh.tsx`, `utils/msdf/*`,
`utils/textLayout/*`):

| Option | Per-glyph control | Extrusion / lighting | Cost to us | Verdict |
|--------|-------------------|----------------------|-----------|---------|
| `troika-three-text` (SDF) | none (no glyph index attributes yet, one font per text) | flat only, but works with Three materials | new dependency | not now; flat text already exists in 2D Pixi |
| MSDF atlas (library `AepMsdfTextMesh`) | instance per glyph | flat only | atlas tooling + shader + 400 lines | not now |
| **`TextGeometry` per glyph** (`three/examples/jsm`) | **a Mesh per glyph: full control** | **real depth, bevel, shadows, PBR** | none: ships with `three` | **chosen** |
| One `TextGeometry` for the whole string | none | yes | none | cannot animate letters |

A spike (Node, no WebGL) showed that `FontLoader.parse` + `TextGeometry` build in plain Node, so they are
unit-testable in vitest: "Fresh every morning" (19 chars, Helvetiker Bold, depth 0.2, 8 curve segments) needs
12 unique glyph geometries (about 4,200 triangles), built in about 12 ms. Glyph advance is `ha / resolution *
size` (Helvetiker: resolution 1000, `H` advance 953). A glyph is cheap enough that one Mesh per character is
fine for titles (up to 200 characters is the schema cap).

Layout is deliberately tiny: advance widths from the typeface JSON, explicit `\n` line breaks, alignment,
`letterSpacing`, `lineHeight`. **Not supported** (and recorded as such): kerning pairs, ligatures, right-to-left
and complex scripts (Devanagari, Arabic), automatic word wrap. The library's 1000-line `textLayout/` engine is
what would add those; it is out of scope. For rich flat 2D text keep using the `text` layer (canvas-drawn).

## Schema additions (applied to `engine/src/schema`)

**Asset**: `{ type: "font", url }`, a Three typeface JSON (`*.typeface.json`). (`.ttf` is an experiment, US-012.)

**Object geometry**: `{ type: "text3d", font: Id, text, size, depth, curveSegments, bevel?, align, lineHeight, letterSpacing }`

| Field | Default | Rule |
|-------|---------|------|
| `font` | – | Id of a `font` asset |
| `text` | – | 1 … 200 chars; `\n` starts a new line; characters missing from the font are skipped and reported as a warning |
| `size` | 0.5 | > 0; world units; roughly the cap height |
| `depth` | 0.1 | ≥ 0; extrusion along z (0 gives flat glyphs) |
| `curveSegments` | 8 | int 2 … 24 |
| `bevel` | none | `{ thickness: 0.01, size: 0.01, segments: 2 }` |
| `align` | `"center"` | line alignment inside the block: `left`, `center`, `right` |
| `lineHeight` | 1.2 | × size |
| `letterSpacing` | 0 | world units added to each advance |

The object's origin is the **centre of the text block** (x: the middle of the widest line, y: the middle of the
line stack, z: the middle of the depth). `material` applies to every glyph (cloned per glyph so each can fade
and recolour on its own). `castShadow` applies to every glyph.

**Tween**: new optional `stagger: { each: Seconds ≥ 0, from: "start" | "end" | "center" | "edges" = "start" }`.
Only valid when `target` is a multi-unit target (below). There is no `"random"`: it would not be deterministic.

**PresetRef.target** (cross-field rule 8) now also accepts `glyphs:<id>`, `words:<id>`, `lines:<id>` on
`enter`, `exit` and `loop` of a `three` layer, where `<id>` is a `text3d` object. If omitted on a text preset
and the layer has exactly one `text3d` object, it defaults to `glyphs:<thatId>`. `PRESET_NAMES` gains the five
text presets below.

## Units and targets

A text object builds this hierarchy (each level is a `Group` pivoted at its own centre, so rotation and scale
look right):

```
object wrapper (the Object3D the schema position/rotation/scale moves)
  └─ line group  × lines          ← target  lines:<id>
       └─ word group  × words     ← target  words:<id>
            └─ glyph group × glyphs (spaces excluded)   ← target  glyphs:<id>
                 └─ Mesh (shared geometry per distinct character, own material)
```

Unit counts: `glyphs` = non-whitespace characters, `words` = runs of non-whitespace per line, `lines` = lines
(blank lines count). `countUnits(geometry)` is a pure function used by validation and presets.

Tweenable properties of a unit target. Position is an **offset from the laid-out rest position**, so tweens never
fight the layout:

| Property | Meaning | Units |
|----------|---------|-------|
| `offset.x`, `offset.y`, `offset.z` | added to the rest position | world units |
| `rotation.x`, `rotation.y`, `rotation.z` | about the unit's centre | degrees |
| `scale` / `scale.x/y/z` | about the unit's centre | factor |
| `alpha` | glyph targets only: sets each glyph material's `opacity` (and `transparent` when < 1) | 0 … 1 |
| `material.color`, `material.emissiveIntensity` | glyph targets only | colour, number |

`words:` and `lines:` refuse `alpha` and `material.*` (null): use `glyphs:` for those.

## Stagger in the compiler

`compileTweens` gets `resolveMany(target, prop) → TargetRef[] | null`. For a tween with `stagger` on a multi-unit
target with `n` units, unit `i` starts at `at + each * order(i)`:

| from | order(i) |
|------|----------|
| `start` | `i` |
| `end` | `n - 1 - i` |
| `center` | `abs(i - (n - 1) / 2)` |
| `edges` | `(n - 1) / 2 - abs(i - (n - 1) / 2)` |

Without `stagger`, all units move together. Total span of a staggered tween: `max(order) * each + duration *
(repeat + 1)`; `validateTargets` warns when that exceeds the layer's length, and `expandPresets` returns an error.

## Text presets

All target a multi-unit target; `params.stagger` (seconds between units) overrides the default.

| Name | Kind | Per-unit duration | Stagger | What it does |
|------|------|-------------------|---------|--------------|
| `glyphRise` | enter | 0.5 | 0.04 | `offset.y` `-distance` → 0 and `alpha` 0 → 1, `power3.out`. `params.distance` default 0.3 |
| `glyphPop` | enter | 0.45 | 0.05 | `scale` 0 → 1 with `back.out(2)`, `alpha` 0 → 1 over the first 40 % |
| `glyphFlip` | enter | 0.6 | 0.05 | `rotation.x` 90 → 0 and `alpha` 0 → 1, `power2.out` |
| `glyphFadeOut` | exit | 0.4 | 0.03, `from: "end"` | `alpha` 1 → 0 and `offset.y` 0 → `params.distance` (default 0.2) |
| `glyphWave` | loop | 1.2 | 0.06 | `offset.y` 0 → `params.amplitude` (default 0.08) → 0, `sine.inOut`; whole periods only; the staggered tail is subtracted from the loop span so every glyph ends at rest |

Placement follows `02-timeline.md`: enter at 0, exit so that the **last** unit finishes at the layer end.

## Files (all new unless marked)

| File | What |
|------|------|
| `engine/src/three/text/typeface.ts` | `parseTypeface(json)` → `{ resolution, ascender, descender, glyphAdvance(ch) }`; `loadFont(url)` (fetch + `FontLoader.parse`, cached) |
| `engine/src/three/text/layout.ts` | `layoutText3D(text, metrics, opts)` pure → glyph/word/line tables with positions; `countUnits` |
| `engine/src/three/text/build.ts` | `buildText3D(spec, font, material)` → `{ root, glyphs, words, lines, warnings, stats, dispose }` |
| `engine/src/three/text/targets.ts` | `resolveUnitTargets(text, kind, prop)` → `TargetRef[]` |
| `engine/src/three/build/object.ts`, `scene.ts`, `threeNode.ts` | edited: build text objects, preload fonts, expose `resolveMany` |
| `engine/src/schema/*`, `engine/src/timeline/*`, `engine/src/runtime/assemble.ts` | edited: asset, geometry, stagger, targets, presets, wiring |
| `engine/fixtures/three-text.json` | the showcase of all five presets |
| `engine/lab/text3d-lab.tsx` (+ two web stubs) | the experiment page |
| `engine/docs/07-text3d-findings.md` | measured results of the experiments |

## Experiments (what US-010 to US-012 must answer, with real numbers)

1. How long does building take for 20, 80 and 200 characters, flat vs depth 0.2 with bevel? How many triangles?
2. Does geometry sharing work (unique geometries = distinct characters), and is everything disposed
   (`renderer.info.memory.geometries` back to its start after destroy)?
3. Do shadows from the glyphs look right with the studio and golden presets? Does `glyphPop` stay smooth at
   200 glyphs (frame time while playing)?
4. Is the same time still the same pixels (hash) with staggered presets, forwards and backwards?
5. Does `TTFLoader` (with `kenpixel.ttf`) work, in the browser and in Node, and what does it cost?
6. Side by side with the 2D `text` layer: where is 3D text worth it, and where not?
7. What would MSDF or troika add that this does not? (Answer from reading, no new dependency.)
