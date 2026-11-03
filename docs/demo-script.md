# Demo script (3:00)

A three-minute screen recording: one product CSV becomes a wall of checked, editable video ads, then one price change re-cuts an ad for $0. A short single-film beat shows the Muse crew and voice.

## Beats and timing

| Time | Beat |
|------|------|
| 0:00–0:15 | The problem: a shop with dozens of products and no video for any of them |
| 0:15–0:55 | One hero film: a spoken brief, the crew builds it, one change mid-build |
| 0:55–1:45 | The catalog: drop the CSV, the wall fills, one ad per product |
| 1:45–2:10 | The check: the verifier flags a row, fixes it, the row turns ready |
| 2:10–2:30 | The edit: $24 becomes $19, the clip updates, cost stays $0.00 |
| 2:30–3:00 | Measured numbers, the replay, the name |

## Narration

**0:00** Every product in a store needs a video ad. Almost none have one, because a freelancer charges per video and every price change means another invoice.

**0:15** MuseReels is a crew of Muse agents. I drop in one photo and say the brief. Muse Voice Transcribe hears me, Muse Wonder writes the storyboard, and Muse Spark builders work on four scenes at once. I ask for a sunset scene while they work, and only that scene is built.

**0:55** Now the whole catalog. I drop in a product CSV and its photos. SAM 3.1 cuts each product out once. Muse Image paints one set per look, a tabletop, a pedestal, a room, and a vision read of each set finds the surface, so every product stands on the table instead of floating in front of the wall. Then every product gets its own ad: its name, its price badge, its brand, straight from the feed, so the price is never invented.

**1:45** Before anything plays, a verifier bakes every frame of every clip from its JSON. It checks that the price stays inside its badge, the text sits above the product, the product stands on a surface and nothing leaves the frame. This row broke a rule. The verifier moved the product onto the table and built it again. Ready.

**2:10** And because it is layers, not a video file, a price change is an edit. I change twenty-four dollars to nineteen. Only that clip is rebuilt, in about a second, and the cost counter does not move.

**2:30** A catalog of products in minutes, for cents per product, every ad checked. MuseReels: your whole catalog, as ads.

## Shot list

| Time | Shot | Screen |
|------|------|--------|
| 0:00–0:08 | A store grid of products with empty video slots | mock store |
| 0:08–0:15 | Cut to the studio, Catalog tab open | studio |
| 0:15–0:25 | Photo dropped in, push-to-talk brief, transcript appears | chat |
| 0:25–0:40 | Storyboard fills, four builder lanes busy (4× badge) | crew board |
| 0:40–0:55 | "Add a sunset scene" mid-build, one new job only | crew board |
| 0:55–1:05 | CSV and photos dropped on the Catalog tab | catalog import |
| 1:05–1:20 | Cut-outs and plates arriving, rows going from queued to building (8× badge) | catalog wall |
| 1:20–1:45 | The wall fills; play two clips: tabletop can, pedestal mug | catalog wall |
| 1:45–2:00 | One row shows the verifier's flag and the fix it made | catalog wall |
| 2:00–2:10 | The fixed row plays: product on the table, price inside the badge | player |
| 2:10–2:30 | Price edit $24 → $19, the clip updates, cost counter unchanged | catalog wall |
| 2:30–2:45 | Numbers: products, minutes, cost per product, rows fixed | title card |
| 2:45–2:52 | Two seconds of Watch it being made | replay |
| 2:52–3:00 | Name, live URL, repo | title card |

## On-screen labels

- Built during the Meta Global AI Developer Hackathon, 27 Oct – 4 Nov 2026
- Engine: our own Three.js engine (built in this hackathon)
- Clips checked from their JSON before any render
- Show "4×" or "8×" whenever footage is sped up

## Recording checklist

- [ ] Run the demo feed end to end once before recording; note wall time and cost per product for the 2:30 card.
- [ ] Use the offline demo film as a fallback for the single-film beat (`npx tsx scripts/demo-film.ts load`).
- [ ] Record at 1920x1080 with the browser zoom at 100%.
- [ ] Never stage a verifier flag: use a feed row that really trips a rule, or cut the beat.
- [ ] Keep the narration under three minutes at a calm pace.
- [ ] Check that no key, passcode or private path is visible.
