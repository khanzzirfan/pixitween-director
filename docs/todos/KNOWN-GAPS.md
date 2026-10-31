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
- [ ] Catalogue test findings: (1) the brand accent is one hard-coded brown for every product, wrong for a stone mug; it should come from the catalogue or from the product photo. (2) Both non-drink picks became price-promo because they were on sale, so the lifestyle-room look has never run on a mug; run `mug-sage` (not on sale) to see it. (3) The variant film's brand is the first two title words, and the tagline is a fixed string; both should come from the feed or the showrunner. (4) The SAM mug cut-out is 267x223, much smaller than the 384x672 photo it came from; check that SAM took the mug and not a crop. (5) Plates are made for `cans`; the lifestyle plate for mugs has not been generated.
- [ ] A newly added image shows empty on the viewer's first load; seek again. A preload wait is needed before any capture or review frames are taken.
