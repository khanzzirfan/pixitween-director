# Turnaround: the real front, a Muse-drawn back, the true depth

Status: built on 2026-11-04 (all 15 stories of `ralph/src/prd-s24-turnaround-3d.json`, done directly in the main checkout on `feat/sqlite-upgrade`, not through ralph). Off by default (`TURNAROUND=1`); MG-1 and MG-2 are the owner's. Designed after a live spike.

## The rule

**The front the viewer sees is always the real photo.** Muse draws only what the photo cannot show (the back, and a side to measure the
depth). No drawn picture ever replaces a pixel of the photo on the product's front.

## Why

The 3D product is built from one photo (`server/product3d/prepare.ts`). A non-cylindrical product (most bottles, flacons, tubs with a
taper) is a body swept from the photo's outline (`engine/src/three/build/geometry.ts`, `buildBody`), and two of its guesses show on screen:

- **The back is the front again.** The body's back half reads the same photo the other way round, so a perfume turned 180 degrees shows
  its front label again ("HABIK" on the back). Seen in the spike, row "today 180 deg".
- **The depth is a guess.** `SOLID.depth` is 55 % of the shorter side (Muse may set `body.depth`). A round bottle comes out as a slab at
  90 degrees. The spike measured the true depth from Muse's side view: 96 % of the width for the perfume, 100 % for the yoghurt tub.

## The spike (4 Nov 2026, `debug/turnaround-spike/`)

`npx tsx debug/turnaround-spike/spike.ts perfume yoghurt`: SAM cut-out, one Muse image edit, one Muse check, two 3D bodies rendered turning
on 5173. Cost $0.0475 (perfume) and $0.045 (yoghurt); the image call took 18-23 s, the check 25-28 s.

| Question | Result |
|---|---|
| Does Muse draw a believable back and sides? | Yes. The perfume's back carries the same rose-gold cage, gems and pink glass, with a different, plausible scroll; the tub's art wraps round and its back is plain pink with the small mark. |
| Does Muse keep the front it is given? | Close, not exact: mean difference 0.044 (perfume) and 0.007 (tub) against the real panel. So the drawn front is used only to line the views up, never as a texture. |
| Do the views agree? | Mostly. Muse drew the left side as a copy of the right (perfume) and put the art sliver on the wrong edge (tub). Drawing only ONE side avoids that; the side is used for depth only. |
| Is the side view useful? | Yes: it gives the true depth (96 %, 100 %) where today's guess is 55 %. |
| Does the Muse check earn its call? | Yes: it named the duplicated sides, a stray metal lump on the back and the wrong-edge sliver. |
| Can today's renderer wear a drawn back? | No. A body always reads one picture on both halves; two bodies back to back render as two bottles. The engine needs a back material slot (one story). |
| Resolution | 4 panels in 1536 x 1024 gave a tub only 386 px wide. 3 panels, the product filling its panel, give about 480 x 950 px per view. |

## The flow

```
photo -> SAM cut-out (exists)
  1. reference: the real cut-out in the LEFT panel of a white 1536 x 1024 canvas (three panels)
  2. Muse image edit (refs: the canvas, the photo): keep the left panel, draw the right side and the back beside it   1 call, $0.04
  3. code: split the three views (whiteKeySheet), measure: the front kept, the back's outline = the front's mirrored outline,
     the back's colours near the front's, the side's depth share in range
  4. Muse check (photo + sheet): same product? problems -> ONE redraw with the problems added to the prompt                1 call, $0.005
  5. code: the back texture = the back view fitted to the front texture's box, colour-matched to it (calibration, not painting)
     the depth share = side width / side height over front width / front height
  6. three.js: the body's front half wears the real photo (as today), its back half the back texture; its depth is the measured one
     a straight cylinder (can path): a label strip whose front half is today's unwrap of the photo and whose back half is the back view's
  7. the s23 product sheet shows the drawn views above the 3D turns; the Plan panel shows the turnaround sheet
```

A **supplied back photo** wins over a drawn one: when the brief carries a second product photo, one Muse look asks whether it is the
back of the same product; if so it is cut out and used as the back view, and nothing is drawn.

## Who does what

| Step | Who |
|---|---|
| the prompt (layout and fidelity rules only) | code |
| drawing the side and the back | Muse image model |
| is the drawing the same product, what to redraw | Muse check |
| splitting, measuring, fitting the back to the front's box, colour matching, the depth | code |
| the film's camera, spin, light | Muse director (unchanged) |

Code never paints on a drawn view (no repainting, no label fixes). Fitting, trimming and one global colour match are calibration.

## Fallback and switch

Every failure (not three views, the views disagree after the redraw, the check still says no, the image call errors) ends with today's
body and one log line. A turnaround never fails a film. `TURNAROUND=1` turns it on; it is **off by default** until the owner's MG-1 shows
the drawn body beats today's. The drawn sheet is cached per photo (by its hash) in the process, so a line-up of one product pays once.

## Cost and time

| Step | Calls | Measured in the spike |
|---|---|---|
| turnaround sheet | 1 image edit | 18-23 s, $0.04 |
| check | 1 vision call | 25-28 s, $0.005 |
| redraw (only if needed) | 1 edit + 1 check | about 45-50 s, $0.045 |
| split, measure, fit | none | under 1 s |

About +45 s and +$0.045 per film, +$0.09 with a redraw. The check and the s23 parts can run side by side with the board, so the wall-clock
cost is lower than the sum.

## Limits

- The back is drawn, so it is plausible, not true. Muse may copy small brand marks onto the back (the perfume's collar band); the
  checker compares with the front photo only. A supplied back photo is the only way to a true back.
- The sides at 90 and 270 degrees are where the photo's edge meets the drawn back's edge; they are seen in passing during a turn.
- A box product is not part of the sheet film today (round shapes take the can path, everything else the body), so boxes are left out.

## Non-goals

An image-to-3D mesh service, photogrammetry, characters, boxes, an approval gate on the drawn sheet.

## Built

Every module is under `server/product3d/` unless a path is given. Tests sit beside each file.

- `turnaround.ts`: `referenceCanvas` (the real cut-out in the left third of a white 1536 x 1024 canvas, floor line at 95 %), `turnaroundPrompt` (layout and fidelity rules, brand terms linted out), `drawTurnaround` (one `image.edit`, refs: canvas then photo, $0.04, problems of the last drawing appended on a redraw), `splitTurnaround` (SAM asked for the product's noun, which keeps a white product's white parts; the white key only when SAM does not find exactly 3 views), `frontDifference` (the drawn front against the real cut-out, both trimmed into one small box: colour difference where both are opaque, 1 where only one is, so the backdrop's tint and a small shift do not count).
- `agree.ts`: `viewsAgree`, the code gate before any vision call: front kept (frontDifference <= 0.12, a guess until live runs measure it), back = the front's outline flipped (IoU >= 0.85), back colour within Lab 25 of the front's, depth share 0.15-1.25, no view over 60 % empty; returns `depthShare` = side aspect over front aspect.
- `turnaround-check.ts`: `checkTurnaround`, one Muse look at the photo and the sheet, both sent at most 1024 px (the full-size look took 52-56 s), $0.005; an unreadable reply counts as ok.
- `back.ts`: `backTexture`, the back view trimmed, resized to the front texture's box, matched channel by channel to the front's mean and spread, and given the front's outline mirrored (where the drawing falls short its row's edge pixel is carried out, so the body has no holes at its sides); `sideTexture`, the side view as tall as the front, colour-matched and filled edge to edge. Calibration only.
- `wrap360.ts`: `wrapStrip`, the label strip of a round product: the front's unwrap for -85..+85 degrees unchanged, the back view's unwrap for the other side, a 10 degree seam.
- `turnaround-flow.ts`: `turnaroundFor` (draw, split, agree, check, redraw once with the problems, or `undefined` with one log line), cached per photo hash; `suppliedBack` (one Muse look: is another photo of the film the back of this product? it wins over drawing).
- `codec.ts`: `decode`/`encode`/`trim`/`trimPng`, moved out of `prepare.ts`.
- `prepare.ts`: `prepareProduct3D` takes `back`; a body returns a `back` asset (the front texture is untouched), a can's label becomes `wrapStrip`. `prepareRound` passes it on.
- Engine: `material.backMap` and `material.profileMap` (`engine/src/schema/layer3d.ts`). An upright body with either wears them blended by view (`engine/src/three/build/views.ts`): the geometry carries `views` coordinates (the photo's u straight through the body, the side picture's u across the depth), and each frame the camera's direction in the body's own space weights the photo, the back and the side (cosine to the 4th power, adding up to 1). Square on, the body is exactly today's; at 90 and 270 degrees it is the drawn side (mirrored on the left), at 180 the drawn back. A first try cut the surface into quarters (4 Nov) and showed the drawn side as bands at the edges of the 0 degree view, against the rule. `textures.back` and `textures.profile` in `shared/aep/layer.ts`, checked by `light-validator.ts`, converted by `web/src/motion/aep/stage3d.ts`. Old films are as before.
- `server/crew/cinematic-cut.ts`: `prepareParts` runs the turnaround beside the board and the form look (`Promise.all`), then re-makes the product with the back; `buildCinematic` passes `backTexture` and the measured depth (a share of the width, converted to the film's share of the shorter side; it wins over any board depth, except for a body lying across).
- `server/crew/sheet-film/render.ts`: the turnaround sheet is saved first (first thumbnail); the product sheet gets a row of the drawn views; `check.ts` tells Muse the 3D back is the drawn back.
- `server/env.ts`, `.env.example`: `TURNAROUND` (off). `server/art/prices.ts`: `turnaroundUsd` 0.04.
- `scripts/live/s24-turnaround.ts`: MG-1.

### Run MG-1

Start the review web server (`DIRECTOR_WEB_PORT=5199 DIRECTOR_API_URL=http://localhost:8797 npx vite --config web/vite.config.ts`), then:

```
npm run live -- s24-turnaround          # dry run: description and the $0.10 estimate
npm run live -- s24-turnaround --yes    # the perfume and the yoghurt tub; or give photo paths
```

Every drawing is saved with its scores (`sheet-N.png`, `views-N.jpg`, `attempts.json`), pass or fail. Open `debug/turnaround/<stamp>/<name>/compare.jpg` (today's body on top, the turnaround body below) and judge at 90, 135, 180 and 270 degrees whether the turnaround body wins while 0 degrees is unchanged. `views.jpg` shows the three views the body is made from.

For MG-2 set `TURNAROUND=1` and make a perfume film in the app: the Plan panel shows the turnaround sheet first, the product sheet shows the drawn views above the 3D turns.

| Product | Time added | Cost | Verdict |
|---|---|---|---|
| perfume (4 Nov, before the view blend) | 85 s (drawing 23 s, look 56 s) | $0.05 | drawn back right at 180; sides at 90-270 holed and striped |
| yoghurt tub (4 Nov, before the view blend) | 97 s, one redraw | $0.09 | round at 90 where today's is a slab; seam at 90 and 270; the back copies the front's art |
| both, with the view blend | to fill | to fill | to fill |

## Next

- Turn `TURNAROUND` on by default once MG-1 and MG-2 pass.
- An image-to-3D mesh option; boxes.
