# Turnaround: the image model draws the product from every side, three.js wears it

Status: design for `ralph/src/prd-s24-turnaround-3d.json`. Written 2026-11-04. Needs `prd-s23-sheet-film-3d` merged first.

## Why

The 3D product today is built from ONE photo (`server/product3d/prepare.ts`):

- round shapes (can, bottle, jar, tube): the front of the body band is unwrapped into a label strip (`unwrap.ts`); the far side is a copy of what the front shows
- boxes and pouches: the photo is the front face; the other faces take the edge colour (`box.ts`)
- anything else: the outline is extruded with the photo as the front (`contour.ts`)

So the side and back of the product are guesses. A perfume bottle turned 180 degrees shows the front label again, mirrored, or a plain
colour. The film spins the product, so the back shows. Clippy solved the same problem with a model sheet: the model draws the thing from
every side once, and every shot reuses it (`debug/storyboard/animal-picnic-heist/iteration-01/sheets/rico.png`).

## The idea

```
photo (front)
  1. MUSE image model draws ONE turnaround sheet: front, three-quarter, side, back, in a row on white, same product, same light
  2. code cuts the four views apart (whiteKeySheet / columnPieces: already used for cut-out sheets), lines them up, checks they agree
  3. MUSE checker (vision, one call): photo + sheet -> "same product" or problems (one redraw, problems added to the prompt)
  4. three.js body from the views:
       round shapes -> a 360 degree label strip stitched from the views (front 0, three-quarter 45, side 90, back 180)
       boxes, pouches, outlines -> the front texture plus a new back texture
  5. the sheet film (s23) uses this body; its product sheet shows the drawn views beside the 3D renders
```

One image, not four: four separate draws drift (the label moves, the cap changes). One sheet keeps the product the same in all views.

## What stays code, what is Muse

| Step | Who |
|---|---|
| the turnaround prompt text (layout rules only: views, plain backdrop, light) | code |
| drawing the four views | Muse image model (`ctx.image.edit`, the photo as reference) |
| cutting, lining up, measuring that the views agree | code |
| "is this the same product as the photo", what to redraw | Muse checker |
| stitching the strip, adding the back texture | code |
| which angles the film shows, the spin, the camera | Muse director (unchanged) |

Code never edits a drawn view. A view that fails is redrawn by Muse (once) or the film falls back to today's body.

## Fallback

Every failure (no four views found, views disagree after the redraw, the checker still says no, the image call errors) ends with the
body `prepareProduct3D` makes today and one log line saying why. A turnaround never makes a film fail.

## Cost and time (estimates, to be measured by the live gate)

| Step | Calls | Estimate |
|---|---|---|
| turnaround sheet | 1 image edit | 15-30 s, about $0.04 |
| checker | 1 vision call | 15-25 s, about $0.005 |
| redraw (only if needed) | 1 image edit + 1 check | 40-55 s, about $0.045 |
| cut, stitch | none | under 2 s |
| total | | +30-55 s, +$0.045 (+$0.09 with a redraw) |

## Limits to say out loud

- The side and back are drawn by a model, so they are plausible, not true. Back-label text can be invented. The checker only compares with the front photo.
- A lathe/strip is right for round products and wrong for a flacon with a flat side. Those take the outline body with a back texture.
- A drawn side view is not exactly orthographic. The strip blends neighbouring views to hide the seams; it will not be a scan.

## Non-goals

An image-to-3D model that returns a mesh (a separate service, not wired in); true photogrammetry; changing the film's camera, spin or
lighting (Muse's board); characters (the same idea would add a Character agent later).
