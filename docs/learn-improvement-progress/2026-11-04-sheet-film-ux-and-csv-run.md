# 2026-11-04: Sheet-film UX, no-builders answer, and the CSV run

What we looked at on submission day: why a 3D film looked dead in the UI, why the four Muse Spark builders never showed, whether CSV catalogs still work, and the cut-out bug the CSV run found.

## 1. The 3D film path (what actually runs)

`FILM_PATH` defaults to `3d` ([server/env.ts](../../server/env.ts)). A new film then goes through `makeSheetFilm` ([server/crew/sheet-film/index.ts](../../server/crew/sheet-film/index.ts)), started from `run-crew.ts`. It is one sequential pipeline, not a crew:

| Step | What happens | Typical time |
|------|--------------|--------------|
| parts | cut the product out (SAM), Muse writes the board, element pictures, set | 50 to 93 s |
| sheets | draw the product, element and set sheets | 9 to 10 s |
| check | Muse looks once at the sheets | 34 to 60 s |
| revise | the board is rewritten from what Muse saw | 38 to 95 s |
| look | film sheet drawn, Muse looks, at most one revision | 80 s |
| commit | the film check and commit | 0 s |

A whole film takes about 2.5 to 5 minutes and costs about $0.035 to $0.065 in Muse and SAM calls.

**Learned: there are no builders in this mode.** The path has no showrunner loop, no scheduler and no builders. The "4 Muse Spark builders" belong to the old 2D crew (`FILM_PATH=crew`, or `CINEMATIC_CUT=0`). The Producer, Listener, Local and Continuity nodes on the crew map are idle leftovers in 3D. Decision: the product is moving to 3D only; showing a couple of busy nodes is nice but not important.

## 2. The lagging-UI fix

**Problem.** During a 3D film the Plan pane said "The showrunner is sketching the plan…", the crew map said "Standing by", and the only sign of life was chat notes arriving 20 to 90 s apart (each Muse call is slow). The film was alive; the UI could not show it. The pipeline emitted only `showrunner.say` and `cost` events, and the panes read `crew.agent` events.

**Fix.**
- `SHEET_STEPS` in [shared/crew.ts](../../shared/crew.ts): the six steps, defined once.
- `makeSheetFilm` emits `crew.agent` events as each step starts. The showrunner is working, thinking or waiting; the critic is thinking while Muse checks the sheets or the film sheet. Both go idle in a `finally`, so a failed film does not leave a lit node.
- [LiveStoryboard.tsx](../../web/src/crew/LiveStoryboard.tsx): the empty state is now `BuildProgress`: the current step, a seconds counter ticking every second, a checklist with finished steps ticked, and the latest note. Falls back to the old hint when no step is active.
- [CrewMap.tsx](../../web/src/crew/CrewMap.tsx): a lit node shows its step under its name.
- New test in `LiveStoryboard.test.tsx`.

**Still true.** Storyboard cards appear only when the film commits, because that is when the pipeline writes the plan. The step list is a fixed six steps, not per scene.

## 3. CSV catalogs still work

Path: Brief screen takes a `.csv` (drop, 📎, or the demo feed) and parses it for product cards ([feed.ts](../../web/src/intake/feed.ts)). `POST /api/lineups` ([lineups.ts](../../server/http/handlers/lineups.ts)) makes one film per product. The runner ([runner.ts](../../server/lineup/runner.ts)) runs `LINEUP_CONCURRENCY` films at a time (default 2) through `runCrew`, which picks the 3D path. State is in `director.db`, so a restart resumes.

The CSV needs `id`, `title`, `price` and `image_link` columns. At most 12 products. 9:16 only.

**Live run, demo feed (`fixtures/catalog/feed-6.csv`), isolated server on 8797:**
- First run: the three coffee films finished; the three mug films failed with "the product in it could not be cut out".
- After the fix below: all three mug films finished (about $0.06 each, 2.5 to 5 min). The six products of the demo feed all make a film now.
- I confirmed each film is `ready` with a composition. I did not review the look of the mug films.

## 4. The cut-out bug the run found

**Cause.** `cutout()` ([server/art/cutout.ts](../../server/art/cutout.ts)) rejects a SAM answer when it covers under 60% (`COVER_MIN`) of what a plain-backdrop key calls product. That check is there to catch an answer that found only a part of the product. The mug photo is a mug on a wooden coaster. SAM finds the mug at 0.96 confidence (and finds nothing for "Stone Mug" or "product"), but the key treats mug plus coaster as the product, so the mug covers 45% and is thrown away. Six SAM calls and one Muse call were spent, then the film failed, silently.

**Fix.** The loop remembers the most confident answer at or above `SURE_CONFIDENCE` (0.9). When every word failed the coverage check and the colour key found nothing, that answer is used. This only changes cases that used to fail the film, so films that worked before are unaffected.

**Not done.** No unit test for the mug case. A failed cut-out gives no log line saying which step refused (SAM found nothing vs coverage rejection); adding one would have saved the probe script.

## 5. Things learned about working in this repo

- Live runs: use the isolated server, never 8787. `PORT=8797 DATA_DIR=data-s-review FILMS_PER_HOUR_PER_IP=50 GENERATE_MAX_PER_HOUR=50 npx tsx server/main.ts`. Editing `server/` restarts a `tsx watch` server and its restart marks building films failed, so check that nothing is building first.
- Scripts that call Meta need the env file: `npx tsx --env-file=.env script.ts`.
- To see why a film failed, read its events: `curl localhost:PORT/api/films/<id>/events` (an SSE stream; use `-m5` so it ends). The `error` event carries `where` and `message`.
- macOS: BSD `sed -i` needs `-i ''`; without it the script is taken as the backup suffix and the file is emptied (this broke one polling script). There is no `timeout` command.
- A background poll that exits at once is suspect: check the script before trusting "done".

## 6. Next

1. Add a cut-out test with a product on a prop (the mug on a coaster) and a log line for each reason a cut-out is refused.
2. Decide whether to hide the idle 2D crew nodes in 3D mode or relabel the map.
3. Look at the three mug films frame by frame before they go in a demo.
4. Run a CSV through the 3D path again after any pipeline change; this was the first run since the 3D uplift.

[Back to the progress log](README.md)
