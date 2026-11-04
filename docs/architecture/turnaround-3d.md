# Turnaround: the real front, a Muse-drawn back, the true depth

Status: design for `ralph/src/prd-s24-turnaround-3d.json`. Rewritten 2026-11-04 after a live spike. Needs `prd-s23-sheet-film-3d` merged first.

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
