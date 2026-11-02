# Cinematic rules

Generated from `server/authoring/cinematic-rules.ts`: do not edit by hand. Run `npx tsx scripts/gen-cinematic-rules.ts`.

The board prompt teaches Muse from this book, the checker holds Muse to it, and the motion check judges the rendered film by it.

## The rules

- A film is 5 to 10 shots and 6 to 12 s in all.
- The first shot is the hook: at most 1.5 s, already moving, and it pushes in from 1.7 times its final distance.
- Every shot but the last lasts 0.4 to 2.5 s.
- The last shot is a hold of 12% to 37% of the film, with no element and no words: the price, name and tagline land there.
- At least 50% of the moving shots are pushes; later pushes start 1.3 times further out, and pushes in a wide shot 1.9 times.
- Use at least 3 different camera moves, and a truck or a crane in every film (they make the set slide past the product).
- At most 2 whips (each at most 1 s, never first or last), 1 rack focus, 2 trucks, 2 cranes, 1 dolly-zoom (never first; a macro dolly-zoom is framed as a close).
- Two shots in a row differ in size, angle or move; never three of one size in a row.
- Exactly one shot is the peak, at 35% to 80% of the film.
- Include a wide shot and a label macro; no element and no words in the macro.
- A cut lands while the camera is moving: the shot before leaves, and the shot after enters, at at least 50% of its mean speed (a hold and the end of a whip are exempt).
- The tremor is 1% of the camera distance, at most 3 keys a shot, and is dropped when the world's 62-tween budget has no room.
- At most 3 shots carry words, each 2 to 5 words and about 4 words a second at most; never a price or a number; the tagline is at most 6 words.
- In the end hold the product stands at most 64% of the frame's height (the shot before it, whose framing the hold keeps, is held to the same), so the name, tagline and price never sit on it.
- A flat, wide product never fills more than 90% of the frame's width, and a flat cut-out turns at most 30 degrees either way.
- The rendered film must move: a moving shot's picture changes at least 0.40% a step (0.1 s), the price hold at least 0.20%, and at least 85% of the film is live.

## The vocabulary

### Shot sizes

| word | meaning |
|---|---|
| `wide` | the product small in its world |
| `medium` | the product at ease in the frame |
| `close` | the product fills most of the frame |
| `macro` | a crop of the label, the frame full of it |

### Camera moves

| word | meaning |
|---|---|
| `push` | the camera moves in on the product (the default; builds desire) |
| `pull` | the camera moves out (the payoff; once) |
| `hold` | the camera stays and drifts (the last shot, or a beat of calm) |
| `orbit` | the camera swings round the product on an arc (shows its form) |
| `truck` | the camera slides sideways past the set, the product staying centred: the world streams by (parallax; the film's motion shot) |
| `crane` | the camera rises or falls while looking at the product, low to high or back (reveals the world) |
| `whip` | a fast swing that brakes into the frame, for a quick cut (short shot, never first or last, at most twice) |
| `rack` | the focus moves from the soft near lights to the product while the camera creeps in (a dreamy reveal, once) |
| `dolly-zoom` | the lens widens while the product holds its size (the reveal; once, late) |

### Camera heights

| word | meaning |
|---|---|
| `low` | looks up at the product (power) |
| `eye` | level (the label and the reveal) |
| `high` | looks down on it (the sensory peak) |

### Phases

| word | meaning |
|---|---|
| `hook` | the first shot: already moving |
| `build` | the middle |
| `peak` | the sensory high point |
| `reveal` | the dolly-zoom |
| `close` | the last shot: the price rests |

### What the product does

| word | meaning |
|---|---|
| `still` | holds still |
| `turn` | turns on |
| `drop` | drops in from above |

### How a shot starts (cut)

| word | meaning |
|---|---|
| `hard` | a plain cut |
| `wipe` | a quick dip to dark across the cut |
| `cloud` | a bloom of light across the cut |

### What an element does

| word | meaning |
|---|---|
| `fall` | drop through the frame |
| `burst` | fly outward |
| `orbit` | circle the product |
| `drift` | float |
| `splash` | a flat card plays its stages |
| `swirl` | a flat card drifts and rolls |

### The set: looks

| word | meaning |
|---|---|
| `beach` | blue sky over a bright sea, sand underfoot (summer, swim, surf, holiday) |
| `pool` | sunlit aqua water all round, light dancing in it (swim, cool drinks, fresh) |
| `sunset` | a purple to orange dusk sky with a low glowing sun, dark ground (evening, warm, romantic) |
| `sky` | open blue sky with soft clouds, a pale floor like cloud (light, air, travel) |
| `studio` | a clean soft grey sweep, no place (tech, tools, neutral products) |
| `night` | a deep blue night with stars, dark ground (premium, bold, one bright object) |
| `garden` | green foliage out of focus, grass underfoot (natural, food, home) |

### The set: air

| word | meaning |
|---|---|
| `none` | clear air |
| `dust` | fine specks drifting round the product |
| `bokeh` | big soft lights drifting near the lens (warm, festive, night, dreamy) |
| `spray` | a burst of droplets in the peak shot (water, fizz, sea) |

