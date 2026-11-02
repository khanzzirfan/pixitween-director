# Submission answers

## Project description

Shelfreel turns a store's product catalog into video ads. You drop in a product CSV and the photos it names. SAM 3.1 cuts each product out once as a transparent layer. Muse Image paints one set per look, such as a tabletop, a pedestal or a room, and a vision read of each set finds the surface the product can stand on, so it never floats in front of the wall.

Every product then gets its own short retail clip built from layers: the product, its name, a price badge with the old price struck through on a sale, and the brand mark. The title and price come straight from the feed, so a model never invents a price. Before anything plays, a verifier bakes every frame from the clip's JSON and checks that the price stays inside its badge, the text sits above the product and the product stands on a surface. What it can fix, it fixes and rebuilds.

Because the ads are layers, not video files, a price change rebuilds one clip in about a second for nothing. For single films, a Muse crew of Wonder and parallel Spark builders takes a spoken brief and builds while you keep directing.

## Track and theme

Track: Startups. Theme: Build for Your World.

## Bonus prizes

| Prize | Claim |
|-------|-------|
| Open weights | Not claimed. |
| Multi-model | Five Meta models each do a distinct job: showrunner, builders and plate reads, set images, product cut-outs and voice. |
| Voice | A spoken brief becomes the film plan through Muse Voice Transcribe, and push-to-talk reaches the showrunner. |
| Vision | SAM 3.1 makes transparent product layers and Muse Spark reviews captured frames for faults. |
| Cost awareness | Every model call is logged as a cost event, and the crew stops at a per-film budget. |

## Claim evidence

| Claim | Evidence | Claimed |
|-------|----------|---------|
| Clips checked from JSON | `server/authoring/verify-clip.ts`, `server/authoring/retail-clip.ts`, `server/media/plate-map.ts` | yes |
| Showrunner and crew | `server/llm/wonder-backend.ts`, `docs/crew.md` | yes |
| Parallel builders | `server/meta/spark.ts`, `fixtures/seed/spark-tool-loop-turns.json` | yes |
| Image backgrounds | `server/meta/image.ts`, `fixtures/seed/cafe-plate.jpg` | yes |
| SAM cut-outs | `server/meta/sam.ts`, `fixtures/seed/mug-cutout-rgba.png` | yes |
| Voice brief | `server/meta/transcribe.ts`, `fixtures/seed/transcribe-brief-response.json` | yes |
| Cost events | `scripts/cost-per-film.ts` | yes |
| Live cost of a crew film | measured on a live run | no, still to be measured |

## Links

- Live: <!-- OWNER:live-url -->
- Code: <!-- OWNER:repo-url -->
- Demo video: <!-- OWNER:video-url -->
