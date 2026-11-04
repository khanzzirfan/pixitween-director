# Catalogue: a line-up of films

A catalogue is made the way one film is made. The old catalogue runner (cut-outs, a fixed look per product, hero
films and line films, a wall of tiles) was removed; its notes remain in `docs/learn-improvement-progress/`.

## The flow

1. The Brief screen takes a CSV (and the photos it names) plus one brief. A CSV means a catalogue; anything else is one film.
2. `POST /api/lineups` (`server/http/handlers/lineups.ts`) reads the feed and makes one film per product: the product's
   photo as the hero asset, and a brief built from the feed's title, category, brand and price, then the owner's words.
   A product whose photo cannot be found has no film and is marked failed.
3. The films run with the same crew as a single film (`runCrew`, or the single director when the crew is off),
   `LINEUP_CONCURRENCY` at a time (default 2), started in line-up order: a free slot takes the next product. A failed
   film never stops the line-up. Each line-up film runs on tighter limits than a single film, because the owner waits for
   all of them: `LINEUP_FILM_DEADLINE_MS` (6 min), `LINEUP_MAX_FIXES_PER_SCENE` (1) and `LINEUP_MAX_AUTO_CRITIQUES` (1).
4. The line-up (`shared/lineup.ts`, stored by `server/lineup/store.ts` under `<data>/lineups/`) only keeps the order and
   each product's state: waiting, making, done, failed. `GET /api/lineups/:id` reads it.

## The studio

`?lineup=<id>&film=<filmId>` opens the ordinary crew studio for that film. Product tabs under the stage
(`web/src/lineup/LineupTabs.tsx`) switch the film; the rail, the stage, the filmstrip and the chat are the film's own.
A note above the chat says which product the crew is on. The studio follows the crew to the next product unless the
owner has opened another tab. A film that has not started has its composer locked, so the crew cannot be started out of order.

## Limits

- At most 12 products: each one is a full paid film.
- A server restart ends the unfinished products as failed; there is no resume.
- Price edits no longer re-cut for free; change the price in the film's chat like any other edit.
