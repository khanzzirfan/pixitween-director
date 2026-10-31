# 09. Camera: shots by film vocabulary, rig moves, camera presets, paths

PRD: `prd-r6-camera` (after R4). Files: `engine/src/three/camera/*`.

Sources of ideas:
- **CozyClay** `frame-shot` (AGPL-3.0, ideas only): frame a shot by size, angle and side instead of numbers.
- **three-story-controls** `CameraRig` (NYT, Apache-2.0; read-only copy in `tmp/three-story-controls/src/CameraRig.ts`;
  port with an attribution header): camera-relative verbs pan, tilt, roll, dolly, truck, pedestal; camera paths as an
  `AnimationClip` set by time (`setAnimationTime`), which is exactly our stateless rule.
- **The library** `components/AepComposition/model3d/cameraMoves.ts`: orbit, crane, dolly zoom, handheld.

All camera motion stays on our GSAP clock: no `flyTo`-style tweens that run on their own (three-story-controls does
that in `flyTo`, which would break seeking).

## frameShot (pure)

```ts
export interface ShotSpec {
  subject: string;                                                    // "object:<id>" or "objects:<id>,<id>"
  size: 'extremeWide' | 'wide' | 'medium' | 'closeUp' | 'extremeCloseUp';
  angle?: 'eye' | 'low' | 'high' | 'overhead';                        // default eye
  side?: 'front' | 'left3q' | 'right3q' | 'leftProfile' | 'rightProfile' | 'back';   // default front
  fov?: number;                                                       // default 35
}
export function frameShot(shot: ShotSpec, box: THREE.Box3, aspect: number): { position: Vec3; lookAt: Vec3; fov: number };
```

- Subject height `h` = box height (or the max of height and width / aspect for wide subjects). The shot size is the
  fraction of the frame height the subject fills: extremeWide 0.2, wide 0.45, medium 0.8 (of the upper 60 % of the box for
  characters: lookAt at 70 % height), closeUp 1.6 (lookAt at 85 % height), extremeCloseUp 3.
- Distance `d = (h × visibleFraction) / (2 tan(fov / 2) × size)`, where `visibleFraction` is 1 except medium/close-ups.
- Angle sets the camera height relative to lookAt: eye 0°, low −20°, high +25°, overhead +80° elevation. Side sets the
  azimuth around the subject's facing (+z): front 0°, left3q −35°, right3q +35°, leftProfile −90°, rightProfile +90°, back 180°.

## Schema additions

- `camera.shot?: ShotSpec` on a `three` layer: when set, it replaces `position`/`lookAt`/`fov` at build time.
- `camera.path?: { keys: Array<{ t: Seconds; position: Vec3; lookAt: Vec3; fov?: number }>; curve: 'linear' | 'smooth' = 'smooth' }`
  (≥ 2 keys, sorted, `t` layer-local): sampled statelessly every update (Catmull-Rom for `smooth`); a path and position
  tweens on the same layer are an error.
- Presets `cameraTo` (enter-like, `params.shot` a ShotSpec; tweens position, lookAt and fov to the framed shot),
  `orbit` (loop, `params.degrees` default 30 around lookAt), `crane` (enter, `params.height` default 1 m, rises while
  keeping lookAt), `dollyZoom` (enter, `params.amount` default 0.5: dolly in while widening fov so the subject keeps its
  size), `handheld` (loop, `params.amount` default 0.6 deg: small rotations from `seedFor(frame)`-driven smooth noise,
  deterministic). All target `camera` on a three layer.

## Rig targets

New tweenable `camera` properties, relative to the camera's rest pose (after `shot`/`position`/`lookAt`):
`rig.pan`, `rig.tilt`, `rig.roll` (degrees, about the camera's own axes), `rig.dolly` (metres along view), `rig.truck`
(metres along the camera's right), `rig.pedestal` (metres along the camera's up). The node recomputes the camera from
`rest pose + rig offsets` in `update` (order: truck/pedestal/dolly, then pan/tilt/roll), so values are absolute
offsets and seeking is stateless.

## Tests

Pure: `frameShot` distances and directions (a 1.8 m box at `medium`, eye, front puts the camera on +z at the expected
distance within 1 mm; `left3q` rotates it by −35°), path sampling at keys and between, rig composition (pan 90 then
seek back to 0 restores the rest pose exactly), every camera preset ends where its table says, `handheld` is identical
for the same frame. Browser: a lab fixture `camera-moves.json` using every shot size and preset.
