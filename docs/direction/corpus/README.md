# Director corpus

Rules the agentic director follows to make product clips and films look like real commercials. It is written for our engine: plates, cut-outs, layers, keyframes and four eases.

## Files and who reads them

| File | Content | Reader |
|---|---|---|
| [01-ad-laws.md](01-ad-laws.md) | The ten laws, format rules, structures for 4 s, 6 s, 15 s and 30 s and films under 3 min, hard nos | Showrunner (planning) |
| [02-looks.md](02-looks.md) + [`looks.ts`](../../../server/authoring/looks.ts) | Six look recipes; material → light; shape → layout; occasion → palette | Showrunner picks a look; the retail clip and finish pass apply it |
| [03-plate-prompts.md](03-plate-prompts.md) | Plate prompt slot order, worked prompts, banned words, light sources, negatives, composition contract | Plate writer (Muse image) |
| [04-motion-and-edit.md](04-motion-and-edit.md) | Anti-slideshow rules, three motion layers, timing table, beat sync, pacing, sound | Builder, `retail-clip.ts`, `finish.ts` |
| [05-critic-rubric.md](05-critic-rubric.md) | Ten pass/fail checks with fixes, plus AI tells | Blind critic |
| [06-reference-films.md](06-reference-films.md) | Measured lessons from 8 reference product ads in `debug/movies/`: push sizes, cut rhythm, end-hold ratio, the variant grammar, tilt entries, halo, label macro; build list R1–R8 | Showrunner, `retail-clip.ts`, the variant-film builder |

Wired in code: looks, `pickLook`, `lookPlatePrompt` / `generateLookPlate`, and `buildRetailClip({ look })` with the light sweep, shadow side, world motion, air, grade, price shape and beat-timed pop. Not yet: the ingredient orbit's cut-outs (it uses bokeh for now), sound hits, and the critic rubric in the review prompt.

## Where it is wired

| Corpus | Code |
|---|---|
| Looks, occasions, shape → look | `server/authoring/looks.ts` (`LOOKS`, `OCCASIONS`, `pickLook`, `productShape`) |
| Plate prompt grammar | `lookPlatePrompt` in `looks.ts`; `generateLookPlate` in `server/art/stills.ts` |
| Laws 4–7, motion table, beats | `buildRetailClip` in `server/authoring/retail-clip.ts` (`pulseKeys(duration, bpm, 'pop' \| 'slam')`) |
| Try a look | `npx tsx scripts/retail-demo.ts <look\|auto> [aspect] [frame] [out.json]` |
| Variant film (06, R1–R6) | `buildVariantFilm` in `server/authoring/variant-film.ts`; demo `npx tsx scripts/variant-demo.ts` |

Player limits found while wiring (31 Oct 2026), logged in `docs/todos/KNOWN-GAPS.md`:
- Track mattes and masks draw empty inside a scene, so the sweep is a soft band kept inside the pack's bounds instead of being clipped to the silhouette.
- Layer rotation is read as radians, so `retail-clip.ts` converts through `deg()`.
