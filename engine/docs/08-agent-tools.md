# 08. Agent tools: bake, QA, explain, receipts, CLI, capture, export pack

Ideas borrowed from **CozyClay** (github.com/NomaDamas/CozyClay, AGPL-3.0: ideas only, no code copied): an
agent writes a spec, a deterministic compiler bakes every frame, QA measures the result and returns grouped findings
with the worst frame and a concrete hint, the agent fixes the biggest group and recompiles. Every edit returns a
receipt and can be undone; stale edits are refused, never silently applied. Output is machine-first JSON with stable
error codes and a recovery step.

PRD: `prd-r5-agent-tools` (after R4). Files: `engine/src/agent/*`, `engine/cli/motion.ts`, capture/export in
`engine/src/runtime/capture.ts`.

## Bake (headless, no WebGL)

```ts
export function bakeDoc(doc: MotionDoc, opts?: { fps?: number; frames?: number[]; measure?: Measure }): Bake;
export interface Bake {
  fps: number; frameCount: number;
  layers: Record<string, LayerTrack>;      // by layer id
}
export interface LayerTrack {
  type: Layer['type'];
  frames: Array<{
    f: number; visible: boolean; opacity: number;              // effective opacity
    bounds: { x: number; y: number; width: number; height: number };   // stage pixels, axis-aligned, after transform
    fontPx?: number;                                            // text: font size × world scale
    three?: { camera: Vec3; objects: Record<string, { min: Vec3; max: Vec3 }> };  // three layers, world units
  }>;
}
```

`bakeDoc` runs `assemble` with `renderer: null` (no chain: a three node with no renderer and no test factory skips
rendering), steps the clock frame by frame (`seekFrame`), and reads transforms, visibility and opacity. Text size uses
`measure` (default: 0.55 × fontSize per character, so Node can bake without a canvas; the browser passes a canvas
measure). The same doc always bakes to the same numbers.

## QA

```ts
export function qaDoc(doc: MotionDoc, bake?: Bake, limits?: Partial<QaLimits>): QaReport;
export interface QaReport { ok: boolean; groups: QaGroup[]; warnings: QaGroup[] }
export interface QaGroup {
  kind: QaKind; subject: string;          // layer id or `layerId/objectId`
  count: number; first: number; last: number; worst: number; worstFrame: number;   // frames
  limit: number; cause: string; hint: string;
}
```

| Kind | Fails when (default limit) | Hint names |
|------|----------------------------|-----------|
| `OFFSTAGE` | a visible layer (opacity > 0.05) has no pixel inside the stage | the frames, and the x/y that would bring it back |
| `CLIPPED` | a visible text layer is cut by the stage edge by more than 2 % of its area | the side and the pixels to move |
| `TINY_TEXT` | rendered `fontPx` < 3.5 % of stage height (≈ 38 px at 1080) | the scale or fontSize that meets it |
| `FAST_TEXT` | a text layer is readable (opacity > 0.8) for less than `0.3 s + words / 3.5` s | the seconds to add to `end` or remove from enter/exit |
| `TEXT_OVERLAP` | two readable text layers' bounds intersect by more than 10 % of the smaller | both ids and the frame |
| `POP` | a property jumps more than 25 % of the stage size (position) or 0.5 (opacity) between two consecutive frames inside the layer's life (not at its start) | the tween index and frame |
| `NEVER_SEEN` | a layer is never visible with opacity > 0.05 | the reason (window, opacity, position) |
| `BELOW_FLOOR` | a 3D object's min.y < shadow `y` − 0.02 m while its layer is visible | the y to add |
| `FLOATING` | a 3D object with castShadow and no tween on position.y has min.y > shadow `y` + 0.02 m | the y to subtract |
| `CAMERA_INSIDE` | a three layer's camera is inside an object's box | the object and a camera position.z that clears it |
| `SUBJECT_OUT` | an object's box projects fully outside its three layer's view | the frames; suggest `frameShot` |

`warnings` use the same shape and never change `ok` (for example `FAST_TEXT` close to the limit). Limits are in
`QA_LIMITS` and can be passed per call; the doc can override them with an optional `qa: { limits }` field.

## Explain (errors an agent can act on)

```ts
export function explainDoc(input: unknown): { ok: boolean; errors: Array<{ code: string; path: string; message: string; hint: string }> };
```

Wraps `parseMotionDoc` and `validateTargets`. Every error gets a stable `code` (`UNKNOWN_KEY`, `BAD_TYPE`,
`OUT_OF_RANGE`, `UNKNOWN_PRESET`, `UNKNOWN_EFFECT`, `UNKNOWN_TARGET`, `UNKNOWN_PROPERTY`, `BAD_REFERENCE`,
`TIME_OVERFLOW`, `SCOPE`) and a `hint`: the closest valid names by edit distance for unknown names, the allowed list for
properties, the max value for time overflows. Example: `layers[2].enter.name: unknown preset "slideUp"; did you mean
"slideInUp" or "fadeInUp"?`.

## Receipts and undo (pure)

```ts
export type EditOp =
  | { op: 'set'; path: string; value: unknown }                   // JSON-pointer-like: "layers/title/x" (layer by id)
  | { op: 'addLayer'; layer: LayerInput; index?: number }
  | { op: 'removeLayer'; id: string }
  | { op: 'addTween'; layerId: string; tween: TweenInput }
  | { op: 'removeTween'; layerId: string; index: number }
  | { op: 'setEffectParam'; layerId: string | null; effectId: string; param: string; value: number | string };
export function applyEdit(doc: MotionDocInput, ops: EditOp[], opts: { expectRevision: number }):
  | { ok: true; doc: MotionDocInput; receipt: Receipt }
  | { ok: false; error: { code: 'STALE_DOC' | 'INVALID' | 'NOT_FOUND'; message: string; recovery: string; details?: unknown } };
export interface Receipt { id: string; revisionBefore: number; revisionAfter: number; affected: string[];
  warnings: string[]; qa?: { ok: boolean; groups: number }; inverse: EditOp[] }
export function undoEdit(doc: MotionDocInput, receipt: Receipt, opts: { expectRevision: number }): /* same result shape */;
```

- The doc carries `revision` (integer, optional in the schema, default 0). `applyEdit` refuses when
  `expectRevision !== doc.revision` (`STALE_DOC`, recovery: "re-read the doc and re-apply").
- All ops in one call apply atomically: if the result does not parse, nothing changes (`INVALID` with the explain errors).
- `receipt.id` is deterministic: a hash of the revision and the ops (no randomness).
- `inverse` restores the doc exactly (deep equal) when applied to the result.

## CLI (`engine/cli/motion.ts`, run with `npx tsx engine/cli/motion.ts <cmd>`; script `engine:cli`)

One JSON object on stdout per call, progress on stderr, exit codes: 0 ok, 1 doc or QA error, 2 usage, 6 stale.

| Command | Does |
|---------|------|
| `explain <doc.json>` | `explainDoc` |
| `qa <doc.json> [--frames a:b]` | `bakeDoc` + `qaDoc` |
| `edit <doc.json> --ops <ops.json> --expect-revision N` | `applyEdit`; writes the doc and appends the receipt to `<doc>.receipts.jsonl` |
| `undo <doc.json> --receipt <id> --expect-revision N` | `undoEdit` with that receipt from the journal |
| `presets` / `effects` / `targets <layerType>` | lists names, defaults and tweenable properties (so an agent never guesses) |

## Capture and the export pack (browser: `engine/src/runtime/capture.ts`)

```ts
export async function captureFrame(rt: MotionRuntime, frame: number): Promise<Blob>;                 // PNG
export async function contactSheet(rt: MotionRuntime, frames: number[], cols?: number): Promise<Blob>; // PNG grid, frame number + time under each cell
export async function renderPass(rt: MotionRuntime, frame: number, pass: 'depth' | 'normal'): Promise<Blob>;
export async function exportPack(rt: MotionRuntime, range: { from: number; to: number }): Promise<ExportPack>;
export interface ExportPack {
  first: Blob; last: Blob; firstDepth: Blob; firstNormal: Blob; contactSheet: Blob;
  camera: Array<{ f: number; layerId: string; position: Vec3; quaternion: [number, number, number, number]; fov: number }>;
  summary: string;   // plain-text shot description built from the doc: layers on screen, text shown, camera moves
}
```

`renderPass` draws each visible three layer with `scene.overrideMaterial` = `MeshDepthMaterial` (packed to grey,
near = white) or `MeshNormalMaterial`, hides 2D layers, background black; the overrides are removed afterwards
and the next normal render is unchanged (same hash). The pack is what an image-to-video model needs (first/last
frame, depth, camera data, a prompt seed) — the same shape CozyClay hands to video models. The lab page gets
buttons for each and downloads the files.
