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

## 3D hero clip (31 Oct)

- [x] `hero-3d` clip built (`server/authoring/hero3d-clip.ts`, tests in `hero3d-clip.test.ts`): a real `model3d` can tumbles in, turns under a moving key light, dolly zoom, price disc on the beat. Checked in the viewer at 0.5, 1.8, 3.0 and 4.6 s.
- [x] The engine's `model3d` shadow ended in a hard-edged dark slab beside the can. Fixed in the engine source: the shadow plane now fades radially to nothing at its edge (`shadowFade.ts`, same rebuilt dist as the fov change, needs the 0.3.4 release). The clip still turns the 3D shadow off and draws a 2D contact shadow, which reads better at this camera angle; the engine's soft shadow is there when wanted.
- [x] Strong dolly zoom: engine `model3d` `camera.fov` is now animatable (reacthub-pixitweenjs source, schema unchanged at 1.11.0; needs a release, 0.3.4). The camera re-frames at every fov, so the can holds its size while the lens goes 20 to 80 degrees. `hero3d-clip.ts` uses it. Until the engine is released, our node_modules copy of 0.3.3 has the rebuilt dist (original kept in `node_modules/reacthub-pixitweenjs/dist.orig`); a fresh `npm install` brings back 0.3.3 and the clip fails the engine schema check.
- [ ] The label is the photo's front arc only: past about 70 degrees either side it is the side colour. The fast spin on entry hides this; a slow full turn would show it.
- [x] Wired into the catalogue: `pickLook({ round })` gives `hero-3d` to a tall round pack not on sale (a sale keeps `price-promo`); `s19-catalog` unwraps the label for tall can/bottle cut-outs (`prepareRound`, free) and builds the clip through `buildCatalogClip` (`server/authoring/catalog-clip.ts`). Checked offline on the cold brew cut-out; not yet re-run live.
- [ ] No liquid splash, pour or droplets: the engine has no particle or fluid system. Options: a crown of 20-40 `prop3d` droplets on ballistic keys, or an emitter member for `stage3d` (engine work).
- [ ] R7 with 3D props (ingredient GLBs orbiting in a `stage3d`) not built.
