# Todo: known gaps (not on the demo path)

- [ ] Fix loops can exceed a live script's timeout; the script then writes nothing (spike run 3 needed a manual recovery from its data dir).
- [ ] The critic and `finish` are not gated on the finished look; only on rules.
- [ ] Playwright cartoon e2e (`e2e/cartoon.spec.ts`) is unrun.
- [ ] Cartoon US-009 cast cards UI not built.
- [ ] 10 known failing tests in the suite (same set on every run); `server/tools/product3d.test.ts` flakes once in a while.
- [ ] Nothing from the pivot is committed yet (about 35 modified and untracked files).
- [ ] Cartoon files owned by the other session (`server/cartoon/props.ts`, `scripts/make-props.mjs`, `web/src/dev/stage-check.tsx`) need merging with its branch.
- [ ] Player (reacthub-pixitweenjs): track mattes draw empty. `Pk` renders the matte source inside an `alpha: 0` container, so the mask texture is blank. Layer masks also draw nothing inside a precomp. The retail clip works around both.
- [ ] Player: layer `transform.rotation` is read as radians although the AEP schema says degrees (a 30° band rendered at about -81°). `retail-clip.ts` converts through `deg()`; check the motion kit and builders for the same bug.
- [x] Look plates generated (31 Oct 2026, $0.05, `npm run live -- s18-look-plates --yes`), 5 plates in `web/public/cartoon/look-plates.json`; files copied into `data/assets`.
- [ ] The pack's base line is fixed at 70 % of the frame (76 % landscape), but each plate's surface sits at its own height. On the pedestal plate the can stands just in front of the plinth's top edge. Fix: a cheap vision pass on the plate returns the surface line, and `retailLayout` takes it as `baseY`.
- [ ] Ingredient orbit has no ingredient cut-outs yet (bokeh stands in); needs 3–4 generated, defocused ingredient stills per flavour.
- [ ] Player: `directional-blur` is in the effect list but has no implementation (no-op). The variant film's whip is a 4-frame slide without blur.
- [x] Catalogue test run (31 Oct 2026, `npm run live -- s19-catalog --yes`, 4 rows of `fixtures/catalog/feed-6.csv`, $0.005, 5-8 s): CSV -> SAM cut-outs (0.95, 0.96) -> look per product -> 4 retail clips + 1 variant film in `web/public/cartoon/catalog/`.
- [x] Catalogue test findings, all fixed 31 Oct 2026 (second run on all 6 rows, $0.015 + $0.005): the accent now comes from the product photo (`server/art/palette.ts`, a white product takes its plate's colour); the brand comes from a new optional `brand` feed column; the tagline from the words the line's titles share (`taglineFor`: "Pick your cold brew", "Pick your mug"); a mug-specific lifestyle plate was generated and `mug-sage` ran on it; the 267x223 mug cut-out is correct (the photo has a coaster under the mug, SAM left it out).
- [ ] Brand falls back to the first two title words when the feed has no brand column; a feed without one should ask the showrunner.
- [ ] A newly added image shows empty on the viewer's first load; seek again. A preload wait is needed before any capture or review frames are taken.
