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
     -> an element to drop leaves the board now; the problems wait for the one revision in step 5
  4. build (exists: buildCinematicFilm) -> JSON rules (new, code only, no render)
  5. film sheet (new): one frame per shot in reading order, labelled "[0.0-1.2s] wide push, hard cut"
     -> measured checks (exists: measureFrames) + one Muse look -> at most one board revision, which also mends the sheet
     problems of step 3, rebuilt, film sheet drawn again. (Until 4 Nov the sheet problems had a revision of their own: about 50 s
     each run, and the concept never changed.)
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
| board revision (only if needed, once, after the film sheet) | 1 | about 40-60 s, $0.005 |
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

## Built

Every module is under `server/crew/sheet-film/` unless a path is given.

- `server/crew/sheet-film/plan.ts`: `secondsIn`, `askedSeconds` (the length the brief asks for, at most 10 s, 8 s by default), `storyboardFromBoard` (scenes of 2 to 8 s for the Plan panel).
- `server/crew/sheet-film/sheets.ts`: `productSheetComp`, `elementSheetComp`, `setSheetComp`, `sheetLabels`; small compositions made from the built film's JSON.
- `server/crew/sheet-film/compose.ts`: `composeSheet`, `swatchesOf`, `labelCrop`; one labelled landscape JPEG per sheet.
- `server/crew/sheet-film/render.ts`: `drawSheets`; draws the three part sheets and saves each as a film asset with role `sheet` (an `art.asset` event follows).
- `server/crew/sheet-film/check.ts`: `sheetCheckPrompt`, `parseSheetCheck`, `checkSheets`; one Muse look at the sheets beside the photo ($0.005).
- `server/crew/sheet-film/json-rules.ts`: `jsonRules`, `titleBoxes`, `layoutProblems`; code rules on the built JSON, shared with `scripts/titles-harness.ts`.
- `server/crew/sheet-film/film-sheet.ts`: `filmSheetTimes`, `filmSheetLabels`, `lookAtFilm`; the film sheet, one Muse look, at most one revision.
- `server/crew/sheet-film/index.ts`: `makeSheetFilm`; the whole run from brief to committed 3D film, returning the seconds of each step.
- `server/authoring/beatsheet.ts`: the board's `locks` (2 to 4 lines, at most 120 characters each).
- `server/crew/cinematic-cut.ts`: `prepareCinematicParts` and `buildCinematic` (additive; `cinematicCut` is unchanged).
- `server/crew/run-crew.ts`: a new film takes the sheet film path; `FILM_PATH=crew` keeps the 2D crew. `FILM_PATH` is declared in `server/env.ts` and listed in `.env.example`.
- `web/src/crew/SheetStrip.tsx`: the sheets as thumbnails above the storyboard in the Plan panel; a click opens one large.
- `scripts/live/s23-sheet-film.ts`: the live gate.

Sheets are saved as film assets with role `sheet` (`shared/composition.ts`, `shared/events.ts`) and shown in the Plan panel.

### Shape: Muse names the form, code writes the numbers

A product that is not a straight can is a body swept from its outline. Its form (`round` for a bottle, can, tub, jar or fruit; `boxy`;
`slab` for a folded towel, pouch or book; `lying` for a rolled towel or loaf) is read by `formFromPhoto`, one focused Muse look at the photo
($0.005) asked while the board is written, and `server/authoring/forms.ts` turns the word into depth and cross-section (round: 0.95 deep,
section 2). The look wins over the board's own `body.form` (`bodyFor`): on 4 Nov a board called the tub a slab, and the sheet check and a
revision spent 89 s mending it. The board's depth is kept only when its form agrees; with no form seen, the board's body is used. Solid elements
carry a form too (`round` berry, `thin` leaf, `chunk` slice). Before this, every body was 0.55 deep with a boxy section, so a round
tub turned into a card at 90 degrees and berries were coins.

### Light budget

Muse's spots add to the key, and on 4 Nov a white tub under a 3.4 key, two spots (4 and 3), a 1.8 rim and a 0.72 glow threshold burned its
lid to flat white. `lightBudget` (cinematic-film.ts) now takes a share of the key and rim per unit of spot strength (never below 0.55), and a
pale product (side colour luma over 0.6) takes less rim and spot and glows only above 0.88; its key stays (a cut key lost a low-key tub in black). The element sheet draws each element halfway through its own two frames, so a splash shows risen, not as the flat disc of its first instant. The numbers are `LIGHT.pale` and
`SPOT.share`/`SPOT.floor` in cinematic-rules.ts.

The element sheet shows one piece of each element (not its swarm, which is empty in a still), and the set sheet keeps the film's air
(bokeh, dust, smoke) with every keyframe held at its first value.

### Run MG-1

Start the API (`PORT=8797 DATA_DIR=data-s-review npm run dev:server:nowatch`) and the web server
(`DIRECTOR_WEB_PORT=5199 DIRECTOR_API_URL=http://localhost:8797 npx vite --config web/vite.config.ts`); the script checks both before it
spends anything. Then:

```
npm run live -- s23-sheet-film          # dry run: description and the $0.10 estimate
npm run live -- s23-sheet-film --yes    # makes the film
```

It prints the seconds of every step and the cost, and writes the sheets, `film.json` and `timings.json` to `debug/sheet-film/<stamp>/`.

## Next

- Delete the 2D crew (`server/crew/workers`, the showrunner tools that only serve 2D) once MG-1 and MG-2 pass.
- An optional approval gate at the film sheet.
- Chat edits of a 3D film.
