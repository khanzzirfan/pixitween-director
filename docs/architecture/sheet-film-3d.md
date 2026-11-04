# Sheet film: every product film is 3D, checked on sheets before it is assembled

Status: design for `ralph/src/prd-s23-sheet-film-3d.json`. Written 2026-11-04.

## Why

A crew film today runs two films at once: the 2D crew (AI builders drawing layer by layer, a vision critic, fix loops) and the 3D
cut. The 3D cut's board is ready about 80 s in, then waits for the 2D crew; at the end Muse judges 2D against 3D. Measured on
`film_16f2214a45dd` (4 Nov): 11 min 18 s and $1.02 in all; the 2D crew's builds were 497 s of work, its 6 fixes 1033 s, its 11
critiques 264 s. The 3D film itself needs about 4 minutes. The 12-minute deadline (`CREW_FILM_DEADLINE_MS`) is hit by the 2D crew.

The 3D film also failed late, where it was expensive to see: a brown tub (the grade was darkened by a wrong "washed out"
warning), an end card named after the brief, an 8 s film where 10 s was asked. Each would have shown on a cheap picture of
that one part, before the film was assembled.

## What Clippy does (studied in clippy-api-monorepo and debug/storyboard/)

- **Model sheets first**, drawn once and reused by every shot: a character sheet (hero pose, turnaround front / 3/4 / side /
  back, expressions, action poses, detail callouts of what must never change: `debug/storyboard/animal-picnic-heist/iteration-01/sheets/rico.png`),
  a location sheet (wide, reverse, closer views, lighting note), and since phase 203.4 a hero prop sheet and a costume sheet.
  Their lesson: a product with no sheet was redrawn differently in every clip.
- **A timed shot list with lock lines** ("Shot 1 [0-2s]: wide establishing ...", "RICO always wears his green knit scarf").
- **A storyboard (sequence) sheet**: the film as 4-8 panels in reading order before anything is rendered
  (`debug/storyboard/animal-picnic-heist/iteration-10-fal-sequence-sheet/sequence-sheet.jpg`).
- **Story blocking** (phase 153): the model writes JSON from a fixed vocabulary, a lint and repair loop corrects it, and a 3D
  greybox is rendered per shot. Our board is already this: a fixed vocabulary of moves, cuts and actions, checked by
  `reviewBoard`, built into stage JSON by `buildCinematicFilm`.

## The sheet film (ours)

Every sheet is a render of the real 3D film parts by our own engine: no picture is drawn by AI, so a sheet costs nothing but
render time, and it shows exactly what the film will show.

```
brief + photo
  1. parts (exists: prepareParts in server/crew/cinematic-cut.ts): product cut-out / 3D body, Muse's board, element pictures,
     set backdrop, music. The board now also carries lock lines and the asked length is enforced.
  2. sheets (new): product sheet, element sheet, set sheet  -> saved as film assets (role 'sheet'), shown in the Plan panel
  3. sheet check (new, one Muse call): the sheets beside the photo and the board -> fine, or problems + elements to drop
     -> at most one board revision (planBoard with the problems as violations)
  4. build (exists: buildCinematicFilm) -> JSON rules (new, code only, no render)
  5. film sheet (new): one frame per shot in reading order, labelled "[0.0-1.2s] wide push, hard cut"
     -> measured checks (exists: measureFrames) + one Muse look -> at most one board revision, rebuilt, film sheet drawn again
  6. commit the 3D film (exists: commitCuts with no flat cut), write the storyboard from the board, status ready.
```

No 2D crew, no 2D-versus-3D judging. A product the 3D path cannot make (no photo, the cut-out fails) ends `failed` with a plain
reason; the 2D crew is not a fallback any more (it is switched off by `FILM_PATH=3d`, the default; `FILM_PATH=crew` keeps the
old path until the 2D code is removed in a later PRD).

### The sheets

| Sheet | Panels | Checks |
|---|---|---|
| Product | the photo; the 3D product front, 3/4, side, back on a neutral studio set under neutral light; a crop of the label; 4 colour swatches from the photo and 4 from the front render | the 3D product matches the photo: shape, label, colours (the brown tub, a wrong cut-out) |
| Element | each board element alone, as the film draws it, labelled with its id and action | each element is what the board names (red caps instead of raspberries) |
| Set | the empty set wide and from the reverse, under the board's own light and grade, with the key colours | the world reads as the board meant (a dark or washed grade) |
| Film | one frame per shot (the middle of each shot, the last shot's last frame), labelled with time, size, move, cut and words | framing, a cropped or covered product, the words, the pacing, the lock lines |

Sheets are landscape JPEGs, panels letterboxed, labels in white on a dark bar. Product, element and set sheets are rendered
from small compositions built for the sheet (`server/crew/sheet-film/sheets.ts`), each frame of the composition one panel,
drawn with `renderKeyFrames` (server/crew/frame-review.ts) at one frame per panel.

### Lock lines

The board gets `locks`: 2 to 4 short lines Muse writes about what must stay true in every shot ("the tub is white with a pink
label", "the berries on the label face the lens in the end hold"). Shown to Muse at the sheet check and the film-sheet look.

### JSON rules (code, before any render of the film)

On the built composition: it validates (`lightValidate`); its length is the asked length +-0.5 s; the product prop exists in
every shot's camera view (fill > 0.08); no title prop sits over the product's screen box for most of a shot; every title is
inside the frame (3 % margin); at most 12 props per stage world. The title checks move from `scripts/titles-harness.ts` into
`server/crew/sheet-film/json-rules.ts` so the harness and the film share them.

### Muse calls and time (estimates, to be measured by the live gate)

| Step | Calls | Estimate |
|---|---|---|
| parts (board, product name, element pictures) | 1 board + 1 name read + 1 picture per element | as today, about 80 s, about $0.05 |
| sheet check | 1 vision call with 4 images | about 15-25 s, $0.005 |
| board revision (only if needed) | 1 | about 40 s, $0.005 |
| film sheet look | 1 vision call with the photo and the sheet | about 15-25 s, $0.005 |
| renders | sheets + film sheet, one headless page each | about 30-60 s |
| total | | about 2-4 minutes, about $0.06-0.10 |

### Non-goals (this PRD)

Deleting the 2D crew code (a later PRD, once the sheet film has run on real products); an approval gate at the film sheet
(Clippy has one; ours may come later as an option); chat edits of a 3D film after it is ready (a message still reaches the
showrunner, whose 2D tools do not edit the stage world).

### Where the work starts

The branch must include the uncommitted work of 4 Nov 2026 (3D titles, backdrop fill, product-covered rule, quotedName,
LENGTH_SLACK, the washed-out gap, the Regenerate button, `ringFor(jobs, id, filmStatus)`). The owner commits it before the run.
