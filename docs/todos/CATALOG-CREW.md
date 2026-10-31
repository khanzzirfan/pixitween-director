# Todo: Catalog Crew

Planner items 8 to 10. Full design: `docs/hackathon/catalog-crew-plan.md` and `catalog-crew-demo-plan.md` (local, git-ignored).
Nothing is built yet (31 Oct). If C3 is not working by **Sun 1 midday**, ship the cheap version below.

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
