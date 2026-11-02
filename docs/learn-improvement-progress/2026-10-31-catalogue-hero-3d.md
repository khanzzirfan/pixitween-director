# 31 Oct 2026: the 3D hero in the catalogue

The Catalog Crew turns a CSV feed into one clip per product. Tall round packs (cans, bottles) that are not on sale now get the 3D hero clip ([entry](2026-10-31-3d-hero-clip.md)) instead of the flat 2D retail clip.

## The rule

| Product | Look |
|---------|------|
| Tall round pack, not on sale | `hero-3d` |
| Anything on sale | `price-promo` (the price leads) |
| Short or flat pack, or a class with no round shape (mug, box) | its 2D look, as before |

## Code

| Piece | File | Notes |
|-------|------|-------|
| `pickLook({ round })` | `server/authoring/looks.ts` | New `round` input and a `ClipLook` type (`LookId` plus `'hero-3d'`). `hero-3d` has no recipe in `LOOKS`; it is its own builder |
| `prepareRound` | `server/authoring/catalog-clip.ts` | Calls `prepareProduct3D` for tall can or bottle cut-outs; returns nothing when the class has no round shape, the pack is not tall, or no straight body can be found |
| `buildCatalogClip` | `server/authoring/catalog-clip.ts` | One entry point per product: `hero-3d` needs the prepared label and refuses without it |
| `s19-catalog` | `scripts/live/s19-catalog.ts` | Prepares labels after the cut-outs; a 3D product skips plate generation (the world is drawn) |

Tests: `server/authoring/catalog-clip.test.ts` (5), `looks.test.ts` (new cases), `hero3d-clip.test.ts` (8).

## Live run (paid, small)

`DATA_DIR=./data-s19-hero3d npm run live -- s19-catalog --yes` on `fixtures/catalog/feed-6.csv`. Estimate $0.025 at most; actual about $0.005 (two SAM cut-outs, no plates needed). It prints an estimate and does nothing without `--yes`.

| Product | Look |
|---------|------|
| Cold Brew, Vanilla Cold Brew | `hero-3d` |
| Mocha Cold Brew (sale), Stone Mug (sale) | `price-promo` |
| Sage Mug, Night Mug | `lifestyle-room` |

Two variant films (drinks, home) were also built. Output: `web/public/cartoon/catalog/` with an `index.json`. To view the clips, copy the run's assets into `./data/assets`, start the API server, and open `/stage-check.html?film=live&file=/cartoon/catalog/cb-original.json`.

## Findings

- The accent comes from the photo, so the sample can (`#402f27`) gives a darker clip than the demo orange. Worth lifting the field when the accent is very dark.
- `data-s19-hero3d/` made a docs preflight check fail (it names every top-level folder). Per-run data dirs are now ignored with `data-*/` in `.gitignore`.
- Without the API server the can's label returns 500 and the 3D layer does not draw, while the 2D parts of the clip still play.

Index: [README.md](README.md).
