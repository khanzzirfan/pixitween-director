# 09. Camera: shots by film vocabulary, rig moves, camera presets, paths

PRD: `prd-r6-camera` (after R4). Files: `engine/src/three/camera/*`.

The authoring side of this spec is [camera-guide.md](camera-guide.md): the vocabulary with what each
shot size frames, the units of the rig moves, the presets' parameters and four complete recipes.

Sources of ideas:
- Film shot vocabulary: frame a shot by size, angle and side instead of numbers.
- Camera-relative verbs pan, tilt, roll, dolly, truck, pedestal, and camera paths sampled by time, which is exactly our stateless rule.
- **The library** `components/AepComposition/model3d/cameraMoves.ts`: orbit, crane, dolly zoom, handheld.

All camera motion stays on our GSAP clock: no `flyTo`-style tweens that run on their own (they would break seeking).

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
- Presets `cameraTo` (enter, `params.shot` a ShotSpec; tweens position, lookAt and fov to the framed shot),
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

The signs follow the camera's own axes (the right-hand rule, as in three.js): a positive `rig.pan` turns the camera to
its left, a positive `rig.tilt` lifts the view, a positive `rig.roll` tips the camera's right side up. A positive
`rig.dolly` moves the camera towards the subject, a positive `rig.truck` to the right, a positive `rig.pedestal` up.
The travels ride the rest pose's own axes, so a pan does not change where a truck puts the camera, and a dolly rides
the optical axis, so it changes no rotation.

## Camera presets

Five presets move the camera of a `three` layer. They are ordinary presets (`engine/docs/02-timeline.md`,
"Presets"), so they live in `timeline/presets.ts` and are compiled onto the clock like any other tween. Two of
them need to know where the camera is, so the runtime passes the camera's rest pose and a shot resolver into the
preset context:

```ts
export interface CameraState {
  position: [number, number, number];   // the rest pose: where the camera stands
  lookAt: [number, number, number];     // and what it looks at
  fov: number;
}
```

- `cameraTo` (enter, 1.5 s): frames `params.shot` and tweens the camera's position, look-at point and lens to
  the framed shot. The framing is the runtime's job, because only it knows the subject's world box.
- `crane` (enter, 2 s): lifts the camera by `params.height` metres (default 1) and keeps the look-at point.
- `dollyZoom` (enter, 1.5 s): dollies the camera in by `params.amount` (default 0.5, a fraction of its distance
  to the subject) while the lens widens. What keeps the subject the same size in frame is
  `distance × tan(fov / 2)`, so the lens is keyed often enough that the straight lines between the keys keep
  that product within half a percent of its constant (4 keys for a wide move, 32 for the longest one).
- `orbit` (loop, 6 s): swings the camera around the look-at point by `params.degrees` (default 30) and back, so
  the move loops. The camera keeps its height and its distance from the look-at point; only its azimuth around
  it changes. The swing is a cosine, so the camera leaves and returns to its start with no speed at either end.
- `handheld` (loop, 2 s): wobbles `rig.pan` and `rig.tilt` by `params.amount` degrees (default 0.6). The wobble
  is `seedFor` noise smoothed over keys 4 Hz apart, so the same layer always shakes the same way, and it never
  leaves the camera more than `amount` degrees off.

A camera preset needs a layer whose rig is built: a layer with a glTF builds its rig asynchronously, so its
camera presets are skipped (and its camera tweens do not resolve) until the assets are in.

## Tests

Pure: `frameShot` distances and directions (a 1.8 m box at `medium`, eye, front puts the camera on +z at the expected
distance within 1 mm; `left3q` rotates it by −35°), path sampling at keys and between, rig composition (pan 90 then
seek back to 0 restores the rest pose exactly), every camera preset ends where its table says, `handheld` is identical
for the same frame. The camera presets: `cameraTo` ends on the framed shot, `orbit` is back at its start after two
whole periods, `dollyZoom` keeps `distance × tan(fov / 2)` within 1 % across the move, and `handheld` stays within
its amount. Browser: a lab fixture `camera-moves.json` using every shot size and preset.

## The camera reel (engine/fixtures/camera-moves.json)

One fixture, one chapter per thing the camera can do, 20.5 s at 30 fps. Every chapter is its own three layer, so
only one is on screen at a time. The scene is plain geometry (a robot and a can on the floor) because a glTF layer
builds its rig asynchronously and the presets are expanded at assemble time, before the rig exists.

| Chapter | Layer | What it shows |
|---------|-------|---------------|
| `shot-extreme-wide` | `camera.shot` `extremeWide` | the whole scene small in frame (the camera stands 18 m back on a 50° lens) |
| `shot-wide` | `camera.shot` `wide` | the robot and the can whole, with room around them |
| `shot-medium` | `camera.shot` `medium` | the robot from the chest up |
| `shot-close-up` | `camera.shot` `closeUp` | the robot's head: the dark visor across the top of the frame |
| `shot-extreme-close-up` | `camera.shot` `extremeCloseUp` | the visor alone, filling the frame |
| `move-camera-to` | `enter: cameraTo` | the camera travels from a wide rest pose to a framed medium shot |
| `move-orbit` | `loop: orbit` | the camera swings 35° around the look-at point and back |
| `move-crane` | `enter: crane` | the camera lifts 1.6 m, so the robot drops in the frame |
| `move-dolly-zoom` | `enter: dollyZoom` | the camera dollies in while the lens widens: the robot keeps its size, the perspective stretches |
| `move-handheld` | `loop: handheld` | the camera wobbles a couple of degrees, deterministically |
| `move-path` | `camera.path` | the camera follows three keys, sampled statelessly |

A shot's `fov` is part of the vocabulary here: the tighter the shot, the longer the lens, so the close-ups are not
shot wide-angle. The `near` plane is 0.05 m, because an extreme close-up stands a few centimetres from the subject.
