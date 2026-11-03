# Muse: decisions and tasks

A running list of what we decided about the cinematic films and what is left, so Muse (and the next agent) end up with the lessons. Verdicts on real films live in code at `server/authoring/form-verdicts.ts` and go into Muse's prompt as examples; add a line there each time a film is judged by eye. Nothing here is committed.

## Rules we hold

1. Muse decides every creative choice; code supplies tools and breakage or safety checks only. No per-product hard-coding.
2. Judge a film from frames by eye (and the owner's verdict), never from tests alone.
3. A worse film must never replace a better one: the 2D film is the baseline.
4. Live runs use an isolated server (8797, `DATA_DIR=data-s-review`); 8787 is the owner's dev server.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-03 | Cut-out products are built as a solid body (extruded outline with a rounded section), depth a share of the shorter side | flat cut-outs looked 2D; a wide roll became a puck when depth followed the width |
| 2026-11-03 | A colour key is trusted only if under 20% see-through | a ghost can key (49%) rendered as a pole |
| 2026-11-03 | Failure words ("not visible", "unknown") never reach the screen as captions or product name | "NO PACK VISIBLE" end card |
| 2026-11-03 | A SAM answer must cover at least 60% of what the photo shows against its backdrop (`COVER_MIN`) | asked for "yoghurt", SAM returned the strawberry printed on the pot, built into a red blob |
| 2026-11-03 | Frame review measures burnt-out frames (over 25% pure white in two or more frames) and tells Muse in words | a white pot clipped to white; Muse's own look did name it, the measure backs it up |
| 2026-11-03 | Frame review also measures contrast: if in at least half the frames the middle of the picture is within 0.05 colour distance of its surround, Muse is told the product does not stand out (`CONTRAST_MIN`) | the yoghurt pot vanished into a cream set (measured 0.01-0.07 against 0.15-0.30 on good films) |
| 2026-11-03 | Frame review measures over-saturation: the product's middle above 85% HSV saturation in at least half the frames is flagged, with the photo's own saturation quoted | perfume: magenta glass and rose-gold metal merged into one red (frames measured 95% against 45% in the photo) |
| 2026-11-03 | The prompt tells Muse that vivid products turn to one flat colour under grade saturation above about 0.3, high contrast or strong coloured lights | same perfume (grade saturation 0.55, contrast 0.4, hot pink lights) |
| 2026-11-03 | Muse's `form: 2d` is trusted only when its own traits give the reason (soft, lying, or fuzzy edge); otherwise the 3D film is built (`choosesFlat`) | live run: Muse wrote traits for a rigid, upright, crisp bottle and still chose 2d |
| 2026-11-03 | The solid body has an `axis`: `up` (default, rows swept) or `across` (columns swept, for a rigid product lying on its side); Muse picks it from its own traits | a lying rigid product (longboard) was built as an upright pill |
| 2026-11-03 | Baseline wins: after the frame review, Muse sees the photo plus 5 frames of the 2D cut and 5 of the 3D cut (order fixed per film, about half 3D first) and the 3D cut replaces the 2D film only on a clear 3D win (`server/crew/form-pick.ts`). If frames cannot be drawn, the 3D cut is kept as before | the towel film: a worse 3D cut replaced a good 2D film |
| 2026-11-03 | The product's surface is Muse's (`surface`: matte, satin, gloss, metal); satin is the default for every product. Round products were hard-coded metal | the cream matte can rendered silver-gold and lost to its 2D cut |
| 2026-11-03 | The pick was flipped: the 3D film stays unless the 2D cut wins clearly, and Muse is told the owner loves the 3D world and that looking like the photo is no reason for 2D | owner's verdict: the 3D goggles in water look cute and the cylindrical can should be 3D; the 2D cut always wins on likeness because it is the photo |
| 2026-11-03 | The prompt tells Muse that pale products clip and vanish on a pale set | yoghurt film: burnt out first, then lost on a cream set after Muse's fix |
| 2026-11-03 | Muse chooses `form: 3d \| 2d` from the product's traits (rigid, sits, edge, sells); 2d keeps the 2D film | the 3D body suits rigid, upright, crisp-edged products; it spoils soft or lying ones (towel) |

## Traits that decide 3D vs 2D (what Muse reads from the photo)

- **3D works:** rigid, stands upright, round or boxy, crisp edge, sold on form or shine (can, bottle, perfume, cooler).
- **3D struggles:** soft or draping (towel, clothing), lying on its side (a roll becomes a flat pill), fuzzy edges, sold on softness or pattern.

## Tasks

- [x] Solid body, cut-out ghost check, depth from shorter side, caption failure check.
- [x] Muse picks 3D or 2D from traits, with verdict examples in the prompt.
- [x] Review a spread of live films (see "Film review log") and record verdicts.
- [x] Contrast check: the product must stand out from its set.
- [x] Tame the key/rim colour when it swamps the product's own colours (perfume).
- [x] Body axis (`across`) so a rigid product lying on its side (rolling pin, baguette, surfboard) can be a true cylinder or slab.
- [ ] Frame a wide product bigger (the longboard is still small in frame), and handle a lifestyle photo with two products (the longboard photo shows two boards; the cut-out leaves a chunk missing).
- [x] Baseline-wins pick: build 2D and 3D, Muse compares frames, 3D replaces 2D only if it clearly wins.
- [x] 3D material: the cream matte can renders metallic silver-gold (Muse's reason for keeping the 2D can).
- [x] Keep the losing cut as a non-head version so the owner can see both (`commitCuts`: the cut not chosen is committed first, so it sits one version back; undo shows it, redo returns).
- [ ] 3D quality varies run to run: the latest goggles and cooler 3D cuts lost to 2D (cooler lid blown out and blurred; goggles washed in yellow with an odd teal splash shape). Look at making the first 3D cut safer (exposure, glow, streak) so more 3D films survive the pick.
- [ ] `cinematicCut` can run twice on one film (the cooler's history shows the pair of cuts committed twice); find who calls finishFilm twice.
- [ ] Front-view likeness check: the 3D product's front must match the photo.
- [ ] Soft edge on cut-outs for fabric; stop dark props covering the hero.
- [ ] Honour a spin the brief names (can brief asked for a full 360, Muse wrote 222 degrees).
- [ ] MP4 export with blur played back.

## Film review log

Run 2026-11-03 on the isolated server (frames at 12 points of each film):

| Product | Film | Form | Verdict |
|---|---|---|---|
| Beach towel | film_a77e3de64d49 | 2D (Muse chose it from traits) | the 2D film stays; the owner prefers it |
| Cold brew can | film_f8bf1a19941e | 3D | good: solid can, label readable, end card clear |
| Oud perfume | film_6f0c0e4809b1 | 3D | good form, but the red key and rim colours swamp the bottle's own colours; heavy horizontal streaks mid-shot |
| Swim goggles | film_0f9d2ac1e1ef | 3D | good: dive-in water set, clear end card |
| Beach cooler | film_b3d5e0e47a79 | 3D | decent; white lid near clipping, streaks mid-shot |
| Surf longboard | film_0452fea20373 | 3D | passable but small and slanted; a long flat rigid product wants the `across` body axis and a bigger framing |
| Berry yoghurt (new type, white pot) | film_731c0971fc1c, film_e4f4a2d79afd | 3D | first run: SAM picked the strawberry on the label (fixed by the coverage check); second: white pot burnt out, Muse revised it into a cream world where the pot disappears. Still open: needs a contrast check, not only a burnt-out check |

Yoghurt rerun with the fixes (film_f5724052fd36): good. The white pot on a dark berry set, label readable, price card clear; Muse's own look found the first draft burnt out and revised it. Minor: a milk ring wraps the pot mid-film and one swirl transition frame is busy.

Perfume rerun with the fixes (film_e6d27604d775): good. Magenta glass and rose-gold metal stay apart, the name reads, a black set with a clean end card. Muse's own look removed the grade saturation and the streaks.

Longboard rerun with `axis across` (film_dea14aa142e6): Muse chose `across` itself and the board now has volume, not a flat slab. Still small in frame, and the cut-out of this lifestyle photo (two boards on a beach) leaves part of the board missing; Muse's own look flagged it.

Baseline-wins run (3 films):

| Product | Film | Pick | Muse's reason |
|---|---|---|---|
| Cold brew can | film_9143ba5f5ea4 | 2D, clear | the 3D can turned metallic silver-gold with blown highlights; the 2D keeps it cream, matte and legible |
| Perfume | film_5ed353549e58 | 3D, clear | the 3D keeps the bottle whole and legible; the 2D cut halves the bottle mid-film and covers it with end-card text |
| Goggles | film_b2362af8c583 | 2D, clear | the 3D submerges, tints and warps them; the 2D keeps them true to the photo |

The 2D can and goggles films look clean and faithful (checked by eye). The pick leans to the 2D cut because that cut shows the photo itself, so any 3D change of material or colour loses.

After the surface fix and the flipped pick:

| Product | Film | Result |
|---|---|---|
| Cold brew can | film_1d146eddfb3b | 3D kept, clear win. Cream matte can, true colours, label readable, dark ice set (checked by eye). |
| Goggles | film_c853a44d3d8e | 2D: this 3D cut was murky, burnt out and cut off (Muse's frame review saw it too, and its revision did not save it). Earlier 3D goggles runs were good, so this varies run to run. |

Both cuts saved (goggles film_41bf5e912828, cooler film_b059474636bf): the 3D cut sits at the version before the head (goggles v111 -> head v112; cooler v79 -> head v80). Seen by eye: the cooler's 3D cut has a blown-out, soft-focus lid; the goggles' 3D cut is washed yellow with an odd teal splash. Muse's 2D picks were fair. Note the cooler history shows the pair committed twice (v77/78 and v79/80).
