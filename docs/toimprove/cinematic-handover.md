# Cinematic film: handover and next steps

Written 2026-11-03. Submission is 2026-11-04. Read "Standing rules" first.

## Standing rules (from the owner, repeated many times)

1. **Muse decides every creative choice.** Code provides tools (parameters, vocab) and only breakage/safety checks. Never bake taste into code or the prompt: no fixed shot grammar, no mandatory moves, no fixed camera distances, durations or end-card layout. Before finishing any change ask: "did I just decide something Muse should decide?" (memory: `muse-decides-creative`).
2. **The owner does all git commits.** Never commit. Nothing from this work is committed.
3. Never post or send anything on the owner's behalf.
4. Plan first, verify rendered frames (not just tests). Replies are terse ("caveman" style); code, docs and commits are written normally.
5. Never edit server files while a film is running on a watched server (`tsx watch` restarts and kills it).
6. Do not copy the unlicensed droplet-flow code; the technique was rewritten.

## Pipeline in one paragraph

Muse looks at the product photo and writes a **board** (`server/authoring/beatsheet.ts`: elements, beats, set, finish, endCard, light, blur) via `planBoard`. `reviewBoard` runs the breakage-only checker and strips references to dropped elements. `server/crew/cinematic-cut.ts` cuts the product out (SAM), draws the element pictures, paints the backdrop, and calls `buildCinematicFilm` (`server/authoring/cinematic-film.ts`), which assembles one AEP 1.12.0 `stage3d` world plus a `prop3d` product. `web/src/motion/aep/stage3d.ts` converts that to the engine `three` layer; the engine (`engine/src/three/*`) draws it. Everything is a closed-form function of (time, seed), so seeking and export give identical frames.

## What was done this session (all uncommitted)

### 1. Droplets (engine)
- `engine/src/three/build/condensation.ts`: roughness-map beads (red channel = height, green = roughness), fewer and bigger.
- `engine/src/three/build/runners.ts` (+ test, hooked in `object.ts`): drops that hold, then slide in hops (L·x² ease-in, abrupt catch) with trails; clear-water transmission material (ior 1.33); profile read from the geometry (`roundProfile`).

### 2. Muse owns the camera, set colours, end card
- Per-shot `camera` (from/to with fill, height, around, lens, side; ease; focus), ingredient `place` (front/behind/around) and `scale`.
- `set.palette` (top, horizon, ground, glow, band, stars, texture, accent); `look` is only a starting recipe. `server/authoring/set-art.ts`.
- `endCard` style: plate pill|bar|none, price disc|tag|plain, align, text case, weight, accent, pulse.
- Checker (`sheetBreaks`) is breakage-only: 3-14 shots, 4-20 s, shot 0.25-6 s, hold 10-50% with no element or words, text rules, at most 3 non-hard cuts, product visible in the last shot. Old fixed shot rules and `MOVE_RULES` were removed.
- The prompt is an options menu, not a rule list. Reference deck has 4 differently shaped worked boards; example choice is tie-broken by a hash of the product text.

### 3. The "top three" upgrades (this turn)
- **Product spin** (`Beat.spin`): `degrees` (±720), `ease`, `tilt` (±40), `roll` (±30), `lift` (0-2 product heights). Implemented in `productMoves` in `cinematic-film.ts`. The middle key rides the eased curve (`bezierAt(e, 0.5)`) and is linear through. `drop` wins over spin on the same shot. Flat cut-outs are still clamped to ±`CAMERA.flatSwingMax` (30°) yaw; tilt/roll/lift are not clamped.
- **Light**:
  - Per shot `Beat.light`: `from`/`to` (key azimuth), `elevation`, `key`/`rim` strength multipliers. Keys are emitted only for what a shot names (`lightKeys`). Without any, the old default sweep remains.
  - Board `light: { key, rim }` colours. The rim colour needed an engine change: `rimColor` through `engine/src/three/build/lighting.ts`, `engine/src/schema/layer3d.ts` (Lighting3DSchema), `scene.ts`, `shared/aep/layer.ts` (stage `lights.rim.color`) and `web/src/motion/aep/stage3d.ts`.
- **Motion blur** (`Beat.blur`, board `blur`, 0-1 of a frame's time the shutter is open; absent = none):
  - Builder: `motionBlur()` writes `post.motionBlur { samples, shots[] }` (samples 4-10, more for a wider shutter).
  - Schema/converter: `shared/aep/layer.ts` -> `web/src/motion/aep/stage3d.ts` -> engine `MotionBlur3DSchema` on the three layer.
  - Runtime: `MotionRuntime.blurAt(sec)` -> `MotionPlayer` handle -> `MotionStage` -> `Player` -> `ExportDriver.blurAt`.
  - Export: `web/src/export/frameExport.ts` `captureFrames` draws each blurred frame `samples` times across the shutter into a 2D `out` canvas, averaging with alpha 1/(k+1). `exportMp4Exact` and `exportMp4ViaServer` read `out` when the driver has `blurAt`.
  - **Not in the live player, only in exact export.** Exports of blurred films are several times slower (verified: 70 frames at 10 samples took about 7 min in software rendering).
- Prompt sections added: THE PRODUCT'S MOTION, THE LIGHT, MOTION BLUR. Rule-book sentence added in `cinematic-rules.ts`; `docs/architecture/cinematic-rules.md` regenerated with `npx tsx scripts/gen-cinematic-rules.ts`.
- Light keys count toward the 64-tween layer budget (`CAMERA.tweenBudget` 62). The builder adds `lightTweens` to the handheld-shake budget so the tremor gives way to them.
- Dev hook: `web/src/dev/stage-check.tsx` `__stage` now also exposes `blurAt` and `canvas`.

### 4. Cut-out reliability (this turn)
- Cause: SAM only finds things by the word it is given ("goggles" 0.92, "perfume" 0.90, "bottle" 0.96; "product" and "object" find nothing), and a correct word can score just under the 0.5 bar (the cooler scored 0.59-0.60). The old code asked for the last title word and then "product".
- `server/art/cutout.ts`: `alsoTry` words tried in order, one SAM call each (about $0.0025); a find between 0.3 and the bar is kept when no word clears it; then the old generic fallback.
- `server/crew/cinematic-cut.ts`: `otherNouns(title, first)` (rest of the title, end first); when those fail, `nounsFromPhoto` asks Muse for 1-4 nouns (about $0.005) and tries them at 0.35.
- Verified live: the Habik perfume and goggles photos that fell to 2D now produce 3D films (`film_6a7166dd4882`, `film_f1ca3a6ab168`). Only checked they have a stage3d world; their frames were not looked at.

## Verified results

- Real Muse runs: oud (long 18-20° lens, 4 slow shots), cold brew (75° lens, shader cuts), cooler (65->24° lens, beach), cold brew sunrise (tan world, plain price), cooler dusk (amber band, bars, orange tag), cooler `film_7e12bc4bfb4a` (cold key, per-shot light directions, lean/roll/toss, shutter 0.5-0.7). Frames showed distinct worlds and visible light sweeps.
- Tests: 2906 pass, 1 old failure (`server/agent/director.test.ts`, predates this work). Typecheck and lint clean.
- Not verified: a full MP4 export with blur downloaded and played; spin of 360° on a round pack (the cooler is a flat cut-out); rim colour visually on a real film; the new cut-out on more than three photos.

### 5. Solid product body (2026-11-03, after the owner saw the films as "2D flat")
- Problem: every flat cut-out (perfume, cooler, goggles) was a slab only 6 % of its width deep with the photo on its front, held to a 30 degree swing. It read as a card moving in 3D space.
- Fix: `ExtrudeGeometrySchema.section` (engine `layer3d.ts`, AEP `shared/aep/layer.ts`, `stage3d.ts` passes it). With `section` set, `buildBody` in `engine/src/three/build/geometry.ts` sweeps each row of the outline into a superellipse (2 round, higher boxier) as deep as `depth` is to the widest row. Front UVs lay the photo flat; the back reads it reversed so text is not mirrored; seam normals are averaged. `object.ts` sets `alphaTest 0.5` for it.
- Builder: `SOLID = { depth: 0.55, section: 2.6 }` in `cinematic-film.ts` is the default; Muse overrides with board `body {depth 0.05-1.2, section 1-6}` (prompt section THE PRODUCT'S BODY, parsed in `beatsheet.ts`, passed by `cinematic-cut.ts`). The yaw clamp (`flatSwingMax`) on flat products is gone, so a Muse spin and the drop's spin-in play unclamped. Prompt and rule-book text that said a cut-out cannot turn were updated.
- Checked by rendering patched compositions (perfume at yaw 0/75/160, cooler at 0/40/110): real volume, wrapped shading, a readable back. Known limits: side walls smear the photo's edge columns (streaks, worst on the cooler at 90-110 degrees); the back repeats the front picture; a gap in the outline (ornament arms, handles) shows as see-through when turned.
- Not done: no new film was generated with the new code (needs a real run, a few cents); Muse's choice of `body` has not been seen on a real board.
- Ideas to improve: blend the side walls toward the product's side colour, a gentle back-darkening, depth from a depth-estimation model for a real relief, or an image-to-3D model for true geometry.

## How to run and verify

- Dev servers: `npm run dev` (API 8787, web 5173). Use your own ports for checks.
- A real film for checks (costs a few cents; needs the Meta key in `.env`):
  ```bash
  FILMS_PER_HOUR_PER_IP=50 GENERATE_MAX_PER_HOUR=50 npx tsx server/main.ts   # default limits are 3 and 4 an hour
  curl -s -X POST localhost:8787/api/lineups -F "csv=@feed.csv;type=text/csv" -F "photos=@photo.jpg" -F "aspect=9:16" -F "brief=..."
  curl -s localhost:8787/api/films/<id>        # poll .status until ready; .composition is the AEP json
  ```
  Feeds: `fixtures/catalog/feed-*.csv`; photos in `fixtures/catalog/surf/`, `fixtures/catalog/perfume/`. A CSV may hold one row for one film.
- Why a film fell back to 2D: `sqlite3 data/director.db "select substr(event_json,1,300) from events where film_id='<id>' and event_json like '%cinematic prep%'"`.
- Frames: copy the composition to `web/public/tmp-a.json`, start `DIRECTOR_WEB_PORT=5199 DIRECTOR_API_URL=http://localhost:8787 npx vite --config web/vite.config.ts`, then `filmFrames({ base: 'http://localhost:5199', file: '/tmp-a.json', times: [...] })` from `scripts/lib/film-frames.ts` (headless Playwright, swiftshader). Delete the temp file afterwards.
- Gotchas:
  - Vite does not see files added or edited after it started in this sandbox: **restart it** (kill your own PID, never `pkill` by pattern; the classifier blocks it and it could kill the owner's server).
  - tsx adds a `__name` helper that breaks `page.evaluate(fn)`: pass the code as a string.
  - A script run from the scratchpad cannot resolve `sharp`: put it under `scripts/` temporarily and delete it.
  - Never leave `tmp-*` files in `scripts/` or `web/public/`. `git status` still shows `scripts/tmp-frames.mts` and `web/public/tmp-a.json` as deleted (they were committed earlier): that is expected, the owner decides.
  - Tests: `npx vitest run`; typecheck: `npm run typecheck`; lint: `npx eslint server engine/src web/src shared`.

## To do next (ranked)

Each item must be exposed as a Muse option, not a rule (rule 1).

1. **Look at the new features on more films and fix what looks wrong.** Run 3-4 different products (a round can so a 360° spin is allowed, a perfume bottle, goggles, a bag). Look for: spin that reads as a stall in the middle (mid-key easing), tilt/roll on flat cut-outs, a light key that jumps in one frame between shots (the keys for shot n+1 start the frame after shot n ends), rim colour too weak or too strong.
2. **Export a real MP4 with blur** through the UI (Export panel, exact mode and server mode) and check duration, size and speed. Consider lowering default samples or letting the exporter cap them (cost grows with `samples`).
3. **Speed ramps.** Per-shot time remapping (slow motion then snap back) as a Muse option.
4. **Camera paths.** Curves through several points per shot (today only `from` -> `to`), seeded handheld shake as a choice, focus pulls tied to real depth of field with bokeh.
5. **Grade and lens.** Split toning, lens flare streaks, soft highlight glow, letterbox as Muse choices (today: glow, grain, vignette, fringe levels only). The converter already supports `post.grade` (brightness, contrast, saturation, hue) but the board cannot set it.
6. **Environment reflections.** `environment` is only `room` or `none`. Add studio softbox strips, ring light, sunset reflection for chrome products (engine `lighting.ts` `getRoomEnvironmentTexture`).
7. **Scene-internal transitions.** The product passing the lens as a wipe, a light flash, a match cut on shape (next to the gl-transitions shader cuts).
8. **Muse reviews frames.** Render about 6 key frames, let Muse look, revise the board once. Keeps creativity with Muse and catches ugly results.
9. **Spots.** The converter warns `lights.spots are not supported yet` and sets `lights: []`. Wiring spot lights (up to 2 in the schema) would allow more than key/fill/rim.
10. **Floor board.** `defaultBeatSheet` is still a fixed template, used only when Muse fails twice. Keep it as a safety net but check it still looks acceptable.
11. **Cut-out leftovers.** Cache the successful noun per photo; consider a salient-crop fallback when every word fails; add a live test with the Meta key on a few more photos (bags, shoes, tubes).

## Key files

- Board schema and prompt: `server/authoring/beatsheet.ts`
- Rule book and constants (generated doc: `docs/architecture/cinematic-rules.md`): `server/authoring/cinematic-rules.ts`
- Film builder (camera, product motion, lights, blur, end card): `server/authoring/cinematic-film.ts`
- Set painting: `server/authoring/set-art.ts`; reference deck: `server/authoring/reference-deck.ts`
- Cinematic cut (cut-out, board, elements): `server/crew/cinematic-cut.ts`, `server/art/cutout.ts`
- AEP schema and converter: `shared/aep/layer.ts`, `web/src/motion/aep/stage3d.ts`
- Engine: `engine/src/three/build/*` (lighting, condensation, runners, smoke), `engine/src/runtime/MotionRuntime.ts`
- Export: `web/src/export/frameExport.ts`, `serverExport.ts`, `playerCanvas.ts`

## Added 2026-11-03 (second agent): items 4-9 of the quality list

All uncommitted, all Muse options (nothing forced). Rule book sentences are in `cinematic-rules.ts` (doc regenerated).

- **Speed ramps** `Beat.ramp` (points of at/rate). Math: `engine/src/core/speedRamp.ts`. Camera and spin are sampled along the curve (`shakeCamera`, `productMoves`); the world's own motion (liquid, smoke, swarms) follows through `world.timeWarp` -> three layer `timeWarp` -> `warpClock` in `threeNode.ts`.
- **Camera** `camera.via` (waypoints, Catmull-Rom in pose space), `camera.focus` as `{from,to,aperture}` over near/product/far (real depth of field), `camera.shake`; board `handheld` may be `{amount,keys,seed}`, `bokeh`, `aperture` (animatable; `stageDof` got a bokeh weight).
- **Grade** board `grade` (tone, split toning, lens streak, halation, letterbox). New engine effects `splitTone` and `lensStreak` (`engine/src/effects/custom/grade.ts`). Letterbox is two 2D bars that lift for the end hold.
- **Cuts inside the scene** `flash`, `pass` (camera plunges into the product, next shot pulls out), `match` (same size and lens, new angle). They do not count in the 3-shader-cut limit.
- **Frame review** `server/crew/frame-review.ts`: after the film is built, 6 frames are drawn (headless Chromium on the web server, about 27 s) and Muse critiques them; if it names problems the board is revised once (elements and set stay). On unless `FRAME_REVIEW=0`; off in tests. Needs the web server (`EXPORT_RENDER_BASE` or port 5173).
- **Cut-out** `plainKey` colour-key fallback in `server/art/cutout.ts` after every SAM word fails.
- **Limits raised for three layers**: tweens 64 -> 192 (`THREE_TWEENS_MAX`), effects 8 -> 12 (`THREE_EFFECTS_MAX`); `CAMERA.tweenBudget` is 190.
- Verified by frames (in `debug/`): grade/streak/halation/bokeh (`grade-check-strip.png`), pass plunge (`pass-strip.png`). Not verified live: a full Muse run with the review loop, ramps/via on a real film.
- Known failing tests not from this work: `plate-map` (missing asset file in `data/`), `director.test`, `films.test` (89 warnings count); `board-clip` times out only under load.
- Reference worth porting next: `clippy-pixijs-nodejs/src/filters/customTransitions.ts` (shape wipes in the same gl-transitions format) and `shaders/animatedVfxShaders.ts` (light leak, VHS, glitch wave...).
