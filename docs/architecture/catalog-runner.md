# Catalog runner: CSV in, a wall of verified ads out (from the UI)

Spec for `ralph/src/prd-c1-catalog-runner.json`. Replaces the unbuilt S15a/b/c design (variant child films, slots, rebind
jobs, Spark price read), which is archived under `ralph/src/archive/`.

## Why

Today the catalogue path runs only as a CLI script: `npm run live -- s19-catalog feed.csv --yes`
(`scripts/live/s19-catalog.ts`). It reads a CSV, cuts out each distinct photo (SAM), picks a look per product, paints a
plate per look (Muse Image), builds a 4 s clip per product and writes JSON under `web/public/cartoon/catalog/`. No HTTP
route and no screen calls it. The demo needs: drop a CSV in the studio, watch a wall of products fill, see each clip
checked, edit a price and see the clip update at $0.

## What already exists (reuse, do not rewrite)

| Piece | Where |
|---|---|
| CSV parser, `Product`, `shownPrice`, `formatPrice` | `shared/catalog.ts` (`parseFeed`) |
| SAM cut-out of a photo | `server/art/cutout.ts` (`cutout(ctx, { source, noun, sceneId })`) |
| Photo accent colour | `server/art/palette.ts` (`dominantAccent`) |
| Plate per look (Muse Image) | `server/art/stills.ts` (`generateLookPlate`) |
| Saved plates, keyed `look:noun` | `web/public/cartoon/look-plates.json` |
| Plate reads (surfaces, busy grid) | `fixtures/plates/<assetId>.json` |
| Look choice | `server/authoring/looks.ts` (`pickLook`, `LOOKS`) |
| 3D label for tall round packs | `server/authoring/catalog-clip.ts` (`prepareRound`) |
| Clip builders | `buildCatalogClip` (any look), `buildRetailClip` (2D) |
| Placement verifier (no render) | `server/authoring/verify-clip.ts` (`verifyRetailClip`) |
| Film event log + SSE | `shared/events.ts`, `GET /api/films/:id/events`, `web/src/api/sse.ts` (`useFilmEvents`) |
| Player for one composition | `web/src/player/Player.tsx` (`composition: AepCompositionJson`) |

## Design

```
 Studio (rail tab "Catalog")            Server (Hono)                                   Disk (DATA_DIR)
 ┌──────────────────────────┐  POST /api/catalogs (csv + photos | demo)            catalogs/<id>/run.json
 │ CatalogImport             │ ───────────────► parseFeed ─► create carrier film ─► catalogs/<id>/clips/<pid>.json
 │  csv · photos · demo feed │                   └─► runCatalog (background)        catalogs/cutouts.json (cache)
 └──────────────────────────┘                        per photo: cut-out (cached by sha256)
 ┌──────────────────────────┐                        per product: look, plate, accent
 │ CatalogPage ?catalog=<id> │ ◄── SSE catalog.row ── per product: verifyRetailClip ─► ready|fixed|flagged
 │  wall of rows + chips     │                         (hero-3d: buildCatalogClip, check skipped)
 │  one Player               │ ── GET clip ─────────►
 │  price edit ──────────────│ ── PATCH product ────► rebuild clip from stored inputs (no model, $0)
 └──────────────────────────┘
```

- **Carrier film.** Each catalog run creates one film (`films.create`, aspect from the request, title
  `Catalog: <n> products`). Its id gives the run a `ToolCtx` (cut-out and plate calls need one), a cost ledger and an
  event log, so the studio subscribes with the existing `useFilmEvents(filmId)`; no new SSE route.
- **Events.** Two new FilmEvent types in `shared/events.ts`: `catalog.row` (one row's new state) and `catalog.done`.
- **Art is injected.** `runCatalog` takes `art: { cut(bytes, noun), plate(look, occasion, noun) }`. Real art calls SAM and
  Muse Image through the carrier film's ctx. Fake art (`DIRECTOR_FAKE=1`, tests, e2e) trims the photo with sharp and
  paints a flat plate: offline and $0.
- **Caching.** Cut-outs are cached by the photo's sha256 in `DATA_DIR/catalogs/cutouts.json`; plates reuse
  `web/public/cartoon/look-plates.json`. A second run of the demo feed spends $0.
- **Row states.** `queued → cutting → building → checking → ready | fixed | flagged`, or `failed` with `error`.
  - `ready`: the verifier passed in round 1 (`check.rounds === 1`, `check.ok`).
  - `fixed`: it passed after the fixer moved the input (`check.applied` names the move, such as `baseY 0.5 -> 0.74`).
  - `flagged`: blocking groups remain (`check.blocking`, e.g. `NOT_CONTAINED caption_price`).
  - hero-3d rows are `ready` with `check: null` (the verifier only knows the 2D clip).
  Never invent a finding: the chip shows what `verifyRetailClip` returned.
- **Price edit.** Each row stores the exact build input (`row.build`) next to the clip. `PATCH` changes `price`,
  `salePrice` or `title`, rebuilds from `row.build` (the verifier again for 2D looks), saves the clip, emits `catalog.row`,
  and returns the row with `ms` (server time). No SAM, no model, no plate: cost $0.
- **Photos.** `image_link` resolves in this order: an uploaded file whose name equals the link's basename; a repo path
  under `fixtures/` or `data/assets/` (no `..`, no absolute path); otherwise the row fails with
  `photo not found: <link>`. `http(s)` links fail with `remote photos are not supported yet`.
- **Demo feed.** `POST /api/catalogs` with `demo=feed-6` imports `fixtures/catalog/feed-6.csv` (its photos are repo paths).

## Not in scope

Showrunner planning, Spark price read off frames, Publish/MP4, product page mock, variant line films (`buildVariantFilm`).

## Try it

No keys needed: fake mode paints flat placeholder art for $0 and uses its own data dir (`data-fake/`) and ports, so it never touches `./data` or a running dev server.

```bash
npm run dev:fake
```

Open http://localhost:5180, then:

1. **Catalog** tab → **Use demo feed (6 products)**. The URL changes to `?catalog=cat_…` and the wall fills to `6/6 done`. The first finished row plays on the stage.
2. Click **Stone Mug** ($19.00, on sale from $24.00). Untick **on sale**, type `21`, press Enter. The row shows `$21.00` and `updated in N ms · $0.00`, and the player reloads the clip.
3. Try the guards: `-3` shows `Enter a price like 19.00`; on sale with a sale price at or above the old price is refused.
4. Your own feed: **Download a sample CSV** in the panel, edit it, and upload it with **Build catalog**. Rows whose `image_link` is a repo path under `fixtures/` need no photo upload; otherwise upload the photos it names.
5. Stop the server mid-run and start it again: the run settles to `done`, and the rows that were still moving show `stopped: the server restarted…`.

Automated: `npm test` (unit, offline) and `npm run e2e -- e2e/catalog-runner.spec.ts` (browser, fake art).

Real art (billed): `npm run dev` with `META_API_KEY` set. The first demo run spends about $0.02 (SAM cut-outs for 2 photos, plates for looks missing from `look-plates.json`); a second run costs $0.00 because cut-outs are cached by photo in `<DATA_DIR>/catalogs/cutouts.json`. Fake runs keep their cut-outs in memory, so they never poison that cache.
