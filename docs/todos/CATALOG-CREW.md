# Todo: Catalog Crew

Planner items 8 to 10. Full design: `docs/hackathon/catalog-crew-plan.md` and `catalog-crew-demo-plan.md` (local, git-ignored).
Status (31 Oct): the retail clip, variant film, 3D hero clip, looks and the offline catalogue run (`s19-catalog`) are built; the store, wall UI, showrunner planning and live price edit are not. Built pieces: `docs/learn-improvement-progress/`, `docs/motion-kit.md`. What is next: `docs/learn-improvement-progress/2026-10-31-next-steps.md`. If C3 is not working by **Sun 1 midday**, ship the cheap version below.

## Retail clip template (the unit of the catalog)
A short clip per product, like a supermarket product spot: themed plate, pack easing in, price badge that pops then pulses, name fading in, brand badge. Deterministic, $0 per clip apart from the plate.
- [x] `server/authoring/retail-clip.ts` `buildRetailClip`: any aspect, any pack shape, badge in free space beside the pack (never over it), any price length, 2.5 s minimum, tested (14 tests); `scripts/retail-demo.ts` writes a sample film
- [ ] Note: do not run `finishComposition` on a retail clip (its price bump to 168 px would overflow the badge); give it its own grade and music
- [x] Plate per look and product class from Muse Image, cut-out per distinct photo (SAM): `s19-catalog`
- [x] 3D hero look for tall round packs (`hero-3d`, `docs/learn-improvement-progress/`)
- [x] Sale price variant: struck-through old price beside the badge (retail clip and 3D hero)
- [ ] Badge shapes: circle (now), starburst, ribbon; accent colour from the brand
- [ ] Hear and tune the timing at 4 s; add a "ding" sound on the price pop
- [ ] Clip to wall: render posters from frame 2 s

## Cheap version (the fallback, and the first target)
Six products from one master by the deterministic path. No per-product crew run.
- [~] 6 fixture products: `fixtures/catalog/feed-6.csv` (reuses the can and mug photos; a clean photo per product still needed)
- [ ] Swap product image and price on a copy of the master film; reuse the category plate
- [ ] Wall of 6 posters with one live player
- [ ] Live price edit: tiles update in about 2 s at $0

## Full plan stories

| # | Story | Status |
|---|---|---|
| C1 | `shared/catalog.ts`, CSV import, store, 3 fixture feeds | [~] schemas, `parseFeed`, price helpers, 6-product fixture and tests done; store, `POST /api/catalogs` and the 10/30 feeds not yet |
| C2 | Slots on the master composition, `tagSlot` tool, auto-tag | [ ] |
| C3 | `variant` worker: clone master, SAM image swap, bind slots, plate, rules | [ ] |
| C4 | Showrunner `planCatalog` and `dispatchVariants`, budget limits | [ ] |
| C5 | Catalog wall UI, status chips, one live player, hidden capture player | [ ] |
| C6 | Price check: rule on text boxes plus Spark reads the price | [ ] |
| C7 | Live feed edit: `feed.changed`, `rebind` jobs | [ ] |
| C8 | Product page mock (`/p/:catalogId/:productId`) | [ ] |
| C9 | Replay of the catalog build | [ ] |
| C10 | Publish via Clippy, feed CSV, fake | [ ] |
| C11 | e2e: fake crew, 10 products, one price flag fixed, one price edit | [ ] |
| C12 | `npm run live -- s15-catalog` dry run unless `--yes` | [ ] |

Cut order: C10, C9, `copy` hooks, C8, category plates, wall posters.

## Open questions
- Which product photos do we own? Photo quality caps the film quality.
- Does the finish pass survive `variant` cloning (its `finish:` layers and the music asset)?
