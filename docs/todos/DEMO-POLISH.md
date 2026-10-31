# Todo: demo polish (look score 4 or more)

Planner items 4 to 7 and 11. Look spike baseline: about 3.5 of 5 (30 Oct).

## Finish pass (planner 4)
- [x] `server/authoring/finish.ts`: drop-shadow on the product, soft-light grade, shot-start flash, ad type, music layer. Idempotent, tested.
- [x] `scripts/make-bed.mjs`: synthesised 120 bpm bed (ours, no licence); copy in `server/crew/media/bed.wav`.
- [x] `server/crew/finish-film.ts` wired into the `finish` tool, never throws; test in `showrunner-tools.test.ts`.
- [ ] Hear the music in the real player (the stage-check page logged `Empty src attribute` for the audio layer).
- [ ] Check the 9:16 frame at full size (the viewer crops it). Confirm the shadow and grade read well.
- [ ] Film grain: the engine's `filmGrain` is an editor filter, not in the composition schema. Add a `docs/todos/ENGINE-NEEDS.md` row, or skip.
- [ ] Vignette (no radial shape in the schema): same row, or a pre-baked PNG overlay layer.

## Defects seen in the 31 Oct runs
- [x] End card had no price (brief asked for $4.50): `ensurePrice` in `server/authoring/finish.ts` reads any price the brief names ($, €, £, or a code like 12 EUR) and adds it to the last scene when no text shows it. Generic, tested.
- [x] Headline overflowed the frame: the engine wraps at `boxWidth` only for animated text, so `fitText` writes the line breaks into the source and shrinks a too-wide single word. Any aspect, tested.
- [ ] Price contrast on busy plates (dark serif on wood): pick the fill by the plate's luminance.
- [ ] Re-run live to confirm `ensurePrice` and `fitText` on a fresh film.
- [x] Pour scene set to generate mode with no Clippy token (stub shot): `withoutGenerate` in `showrunner-tools.ts`.
- [ ] Wall time swings 164 s to 583 s: run 2 had 15 critic findings and 5 fix jobs.

## Look score (planner 5, 6)
- [ ] Raise `FILM_TIMEOUT_MS` in `scripts/live/s17-spike.ts`, or cap fix jobs; print cost live.
- [ ] Run `npm run live -- s17-spike --yes` with its own `DATA_DIR`; score 1 to 5.
- [ ] Source 3 invented-brand product photos (mug, skincare bottle, sneaker). No real logos.
- [ ] Run the spike on a second product; score.

## Product in the scene (planner 7)
- [ ] Muse Image edit with the product photo as reference for the hero scene (`editProductImage` in `server/art/stills.ts`).
- [ ] SAM cut-out of the result for parallax; fall back to the real photo cut-out plus contact shadow if the label drifts.
- [ ] Raise the cut-out resolution (now 256 x 752).
- [ ] Three planes and a slow push-in as authoring defaults.

## Type
- [ ] Two or three ad type templates (headline in, price punch, end card) as builder defaults, not just the finish pass.
- [ ] Label caption too small: set a minimum size by aspect.
- [ ] Replace the dark panel behind the pour-shot title with a lighter treatment.

## Generated clip (planner 11, first to cut)
- [ ] Get `CLIPPY_TOKEN`; run `s07-generate`; approve one pour clip on screen; show its cost.

## Speed: under 3 minutes (later)
Target: one photo to a finished ad in under 3 minutes. Today: about 6 to 9 minutes (spike runs; run 3 passed 8 minutes in fix loops).
- [ ] Time each stage (plan, plates, cut-outs, builders, critic, fixes) from the event log in `debug/s17/`; find what dominates.
- [ ] Cap fix jobs per scene (1) and skip the critic's second pass when the first has no errors.
- [ ] Run the plate and cut-out calls in parallel across scenes.
- [ ] Skip the Wonder planner when it 503s twice; go straight to the Spark fallback.
- [ ] Show the stage timings in the demo (it is a trust number).
