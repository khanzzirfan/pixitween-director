# Cinematic rules

Generated from `server/authoring/cinematic-rules.ts`: do not edit by hand. Run `npx tsx scripts/gen-cinematic-rules.ts`.

The board prompt offers Muse the options in this book, the checker only catches what would break the film, and the motion check judges the rendered film by it.

## The rules

- A film is 3 to 14 shots and 4 to 20 s in all.
- The floor is 16 by 30 m so it fills the bottom of the frame when the hook's camera starts far back, and the product drops in from 30 cm, so the very first picture has the product in it.
- The camera stays at least 3 cm above the floor, even at a low angle, so the floor is never seen from below.
- Every shot but the last lasts 0.25 to 6 s.
- The last shot is a hold of 10% to 50% of the film, with no element and no words: the price, name and tagline land there.
- Everything else about the shots is Muse's: how many, in what order, which moves, how long, where the peak sits. A move is only a preset (push starts 1.3 times further out, 1.9 in a wide shot, 1.7 in the hook); Muse can write a shot's camera out (fill, height, around, lens, side, ease, focus) and the numbers win. On a flat cut-out the macro's camera is aimed at the label: the spot of the picture with the most small sharp detail (a logo, printed text), kept inside the product.
- The set's colours and the end card's style are Muse's: any #rrggbb for the sky, horizon, floor, glow, sea band and texture colour (set.palette over the look's own recipe), and an end card of a pill, bar or no plate, a disc, tag or plain price, centred or left, as written or in capitals, light to bold, in any accent. A palette colour that is not #rrggbb is dropped.
- A cut lands while the camera is moving: the shot before leaves, and the shot after enters, at at least 50% of its mean speed (a hold and the end of a whip are exempt).
- The tremor is 1% of the camera distance, at most 3 keys a shot, and is dropped when the world's 190-tween budget has no room.
- The product's motion, the light and the shutter are Muse's: a shot's spin is up to two full turns either way (a flat cut-out swings at most 30 degrees), with a lean up to 40 degrees, a roll up to 30 and a toss up to two product heights at the middle of the shot; a shot's light slides the key between any two directions, sets its height (5 to 85 degrees) and its strength and the rim's strength (up to 2.5 and 3 times the film's); the key and rim colours are any #rrggbb; and the shutter is 0 to 1 of a frame's time, per film or per shot, drawn as 4 to 10 pictures averaged in an exact export. Light keys count in the world's 190-tween budget, so the tremor gives way to them. Nothing is on unless Muse writes it.
- The colour grade is Muse's: exposure, contrast, saturation and hue, split-toning tints (any #rrggbb) with a strength and a balance, a horizontal lens streak, halation (a soft glow round the highlights) and a letterbox of 1.85 to 2.6 whose bars stop at 30% of the frame's height and lift for the end hold.
- The camera's path may pass through up to 3 waypoints (a smooth curve through them, sampled at 2 keys a waypoint plus 2); the tremor can be written out (amount 0 to 3 times the usual, 1 to 6 keys a shot, a seed) and set per shot (0 locks the shot); a focus pull runs between the near things, the product and the far set (3.2 m behind the product), with an aperture of 0 to 1 per shot or per film and bokeh of 0 to 1 that lets bright points spread into discs.
- A shot's speed ramp is a curve of up to 5 points (rate 0.05 to 4 times normal); the shot keeps its length and its end, so cuts do not move. The camera and the product's spin are sampled along it at 5 keys between the ends (counted in the tween budget) and the world's own motion runs on the same curve.
- At most 2 shots carry words, each 2 to 4 words and about 3 words a second at most; never a price or a number; the tagline is at most 4 words. The end card says at most 3 things: with a tagline the name, the tagline and the price, without one the brand, the name and the price.
- With a set the high camera looks down 14 degrees, so the horizon and the sea stay in the frame; a glass piece is at most 1.7999999999999998 cm, and a burst flies up and away from the lens. Ice is a clear cube with its corners rounded to 22% of its side and a wet shine; spray is clear round drops, never cubes.
- A set is lit like the reference ads, by the board's key level: a mid key is one key at 4, a rim of 1.5 (2.4 in the end hold) that outlines the product, fill 0.35; a low key keeps the mood (key 3.4, fill 0.2, a 45% vignette) and a high key opens up (fill 0.6). The cut-out's side face is lifted 40% toward white so no black outline shows, and the backdrop's horizon is never near white.
- In the end hold the product stands at most 56% of the frame's height (the shot before it, whose framing the hold keeps, is held to the same), so the name, tagline and price never sit on it.
- A flat, wide product never fills more than 90% of the frame's width, and a flat cut-out turns at most 30 degrees either way.
- A cut may play a shader transition (zoom, whip, ripple, swirl, glitch, burn, streak); at most 3 cuts in a film are anything but a plain cut, and never the first shot's.
- Three cuts happen inside the scene and cost no second render, so they are not counted in that limit: flash (a hot flash of the key light that fades in 0.14 s), pass (the shot before plunges at the product over its last 28% until the product fills the frame, and this shot pulls out of that crop) and match (this shot starts as close and on the same lens as the one before ended, so the product keeps its size and place while the angle jumps).
- The finish is the screen grade over the world: glow (0.55 soft, 1.1 strong; it swells 35% in the end hold), grain (0.07 fine, 0.15 heavy), vignette (0.35 soft, 0.62 strong), an optional colour fringe of 0.0007 and the floor's shine (a reflection of the product, 0.2 matte, 0.42 glossy, 0.65 mirror, fading out 0.3 to 0.55 m from it; only on a set) and wet (beads of condensation on the product, 0.4 light, 0.9 heavy, for a cold drink or a fresh, dewy product) and caustics (light rippling on the floor round the product the way a glass of liquid or a pool throws it, 0.35 soft, 0.7 bright, for drinks, water and anything fresh or aquatic; only on a set); the board picks the levels, and a board that picks none gets them from its key level.
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
| `push` | the camera moves in on the product |
| `pull` | the camera moves out |
| `hold` | the camera stays and drifts (the end shot, or a beat of calm) |
| `orbit` | the camera swings round the product on an arc (shows its form) |
| `truck` | the camera slides sideways past the set, the product staying centred: the world streams by (parallax) |
| `crane` | the camera rises or falls while looking at the product (reveals the world) |
| `whip` | a fast swing that brakes into the frame, for a quick cut (best in a short shot) |
| `rack` | the focus moves from the soft near lights to the product while the camera creeps in (dreamy) |
| `dolly-zoom` | the lens widens while the product holds its size (the background stretches away) |

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
| `zoom` | a zoom blur: the lens rushes through the cut |
| `whip` | a whip pan: a fast sideways smear into the next shot |
| `ripple` | a water drop ripple spreads across the cut |
| `swirl` | a swirl twists the old shot into the new |
| `glitch` | a digital glitch tears the picture across the cut |
| `burn` | a warm film burn washes through the cut |
| `streak` | light streaks sweep across the cut |
| `flash` | a hot flash of the key light that fades at once (inside the scene) |
| `pass` | the product passes the lens: the shot before plunges at it until it fills the frame and this shot pulls out of that crop (inside the scene) |
| `match` | a match cut on shape: this shot opens with the product as large and on the lens the last one ended on, the angle jumping (inside the scene) |

### What an element does

| word | meaning |
|---|---|
| `fall` | drop through the frame |
| `burst` | fly outward |
| `orbit` | circle the product |
| `drift` | float (a liquid floats round the product as wobbling drops) |
| `splash` | a liquid crowns up round the product and breaks into drops (a card plays its stages) |
| `swirl` | a liquid winds round the product in a spiral ribbon (a card drifts and rolls) |
| `pour` | a liquid falls in a stream beside the product into a pool |
| `rise` | a vapour rises in soft wisps behind the product |
| `wrap` | a vapour rolls round the product as a cloud and clears |

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
| `smoke` | slow smoke drifting up behind the product the whole film (oud, incense, whisky, cigars, night, mystery) |

