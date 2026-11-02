# Cinematic assembly: prompt + CSV in, directed films out

Status: plan written 2026-11-02, submission 2026-11-04. **Phase 0 and Phase 1 are built** (2026-11-02); Phases 2 to 6 are not.

Phase 6 result (2026-11-02): one rule book, `server/authoring/cinematic-rules.ts`, holds the vocabulary (sizes, moves, heights, phases, cuts, actions, set looks and air, each with its meaning) and every number (shot list, move limits, words, camera, motion). The board prompt, the checker, the camera builder and the set art read from it, and `docs/architecture/cinematic-rules.md` is generated from it (`npx tsx scripts/gen-cinematic-rules.ts`; a test fails when the file is stale, and another fails when the schema's words differ from the book's). The motion check (`scripts/motion-check.ts`, judged in `server/authoring/motion-check.ts`) seeks the player to every 0.1 s of a hero film, reads the canvas, and measures the share of the picture that changed between neighbouring frames; a step that crosses a cut is left out so a cut is not mistaken for motion. It judges each shot: a moving shot must change at least 0.4 % of the picture a step, the price hold at least 0.2 %, and 85 % of the film must be live. It found a real weak shot on the first run (a wide push on the longboard, 0.19 %), which led to deeper pushes in wide shots (1.9x). On the five surf films the calmest moving shot is now 0.49 % and the others are 1.3 % or more; the old frozen 2D hold measured 0.00 %. Run it: `npx tsx scripts/motion-check.ts <catalogId> [productId ...]` with the app up (no model is called, nothing is spent).

Phase 5 result (2026-11-02): copy moves with the film. The board has a `tagline` (at most six words, under the name in the end hold) and an optional `text` on a shot (2 to 5 words). Words pop in one after another, 0.07 s apart, swelling from 60 % to 112 % and settling, rising 26 px as they fade, each with a soft shadow; a shot's words sit in the lower third and are gone before the cut; the name and the tagline pop the same way in the end hold. The checker keeps the copy honest: at most three shots with words, never the last shot or a macro, about four words a second at most, and never a price or a number in a shot's words. These are our own keys (the engine's glyph presets are not reachable from the AEP text path, and keys give the same look). Two framing fixes found on the way: a wide flat product is capped so its width never passes 90 % of the frame (it had filled the whole frame on a close), and a dolly-zoom named macro is framed as a close, so the end hold keeps room for the price. Real surf run: Muse wrote lines like "Sun's out, dive in" and "See summer clearly", $0.05.

Phase 4 result (2026-11-02): cuts now land while the camera is moving. Every shot but the first and last uses a through-ease that runs at two thirds of its mean speed at both ends (the old ease-out and ease-in-out stopped dead at the cut); the hook enters faster; the product's turn runs through the cut with the camera. `cutSpeeds(plan)` measures this from the plan and a test holds every moving cut to at least half speed on both sides (a hold and the end of a whip are exempt). Handheld is a board field (`handheld`, on unless Muse says false): each push, pull, truck, crane, orbit, rack and hold is sampled along its own path with up to three keys and a small deterministic wobble (about 1 % of the frame), so cuts and holds still meet the plan exactly; it is dropped when the 64-tween budget has no room (`shakeKeysPerShot`). The flash and wipe cuts the board already names straddle the cut by about 5 frames. Checked on frames of the surf films. Not built: a whip that hands its direction to the next shot, a speed streak or motion blur on a whip (the engine's effects are not animatable), and pan, tilt and roll.

Phase 3 result (2026-11-02): the board has four new camera moves, truck, crane, whip and rack (plus the old push, pull, hold, orbit and dolly-zoom), planned in `planCamera`. A truck slides the camera sideways with the target on the product (the set streams past); a crane rises or falls; a whip swings in 55 degrees and brakes; a rack moves the focus from the near lights to the product. The hook now pushes in from 1.7x, later pushes from 1.3x, and sideways moves alternate direction. The checker asks for three different moves, a truck or a crane, and limits the whip, rack, truck and crane. To keep the world inside the engine's 64-tween limit, tweens that start together on one target are merged (`mergeTweens`, camera position and lens move as one). Real surf run: each film got its own mix (rack, truck, whip, crane, orbit), $0.05. Not built: handheld shake, and a move that carries across a cut (Phase 4); the camera rig's pan, tilt and roll are not exposed (every move is a position and lens key).

Phase 2 result (2026-11-02): the board has a `set` (look: beach, pool, sunset, sky, studio, night, garden; air: none, dust, bokeh, spray). Code draws the backdrop (a sky down to a horizon, on a 4 m wall 3.2 m behind the product) and the bokeh dot for free (`server/authoring/set-art.ts`), the engine's floor plane carries the ground colour, and the camera's moves now slide near and far apart: the horizon and sea shift between shots. Dust and spray are swarms of tiny specks, bokeh is four single soft cards (a swarm cannot be a card). A board with no set gets one from its words. Real surf run: Muse picked beach + spray for all five, $0.03. Not done from the Phase 2 list: pictured mid- and foreground pieces (a wave, a palm, spray photos): they cost a Muse picture and a SAM call each, so they wait for a go-ahead.

Phase 0 + 1 result: the run takes a `brief`; every product's hero film is a Muse-directed board played in the 3D world (`server/catalog/hero.ts`, `server/authoring/cinematic-film.ts`). A flat product is its own cut-out, extruded into a standee (turn limited to 30 degrees). A film plays only the free elements (glass); pictured elements wait for Phase 2. The 2D board film is the fallback if a 3D build throws. Real surf run: 6 Muse calls, $0.03; the brief turned the dark moody worlds into bright beach ones. The world behind the product is still empty (Phase 2).

## The rule we hold to

Nobody writes a film by hand: not a person, not Claude. A person gives a **brief** (a prompt) and a **CSV**. Muse directs: it reads the brief and looks at each photo, then writes a **board** in a fixed vocabulary (shots, camera moves, set, elements, light, cuts). Code **assembles** the board into layers. The craft lives in two places only:

1. **The rule book**: the vocabulary and the rules from the corpus, given to Muse in its prompt and to the checker that holds Muse to them.
2. **The assembler**: turns each word of the vocabulary into layers and keyframes, the same way every time.

To make films more cinematic we add words to the vocabulary, teach Muse when to use them, and teach the assembler how to draw them. We never edit a film.

## What we have today (checked in the code)

| Piece | Where | What it does | Gap |
|---|---|---|---|
| GSAP timeline | `engine/src/timeline/compile.ts`, `engine/src/core/clock.ts` | Every keyframe, 2D and 3D (camera, objects, lights, focus), is compiled onto one GSAP master timeline. | None. GSAP is applied to three.js. |
| 3D camera rig | `engine/src/three/camera/rig.ts`, `engine/docs/09-camera.md` | pan, tilt, roll, dolly, truck, pedestal, plus presets `orbit`, `crane`, `dollyZoom`, `handheld`. | The director's path (AEP JSON → `web/src/motion/aep/stage3d.ts`) only passes camera **position** and **fov**. Muse cannot reach the rig or the presets. Camera target cannot animate. |
| 3D cinematic film | `server/authoring/beatsheet.ts` (Muse board) + `cinematic-film.ts` (assembler) | Muse writes concept, elements, 5–10 shots; the assembler plays them with a real three.js camera, a moving key light, swarms, depth of field and cuts. | Only used for **tall round packs** (can, bottle) in the crew path. The world is empty: `set: {ground: 'none', wall: false}` plus a flat 2D colour and halo behind. |
| 3D catalog hero | `server/authoring/hero3d-clip.ts` | Fixed script, no Muse. | Same: round packs only. |
| 2D catalog board | `server/authoring/catalog-board.ts` + `board-clip.ts` | What the surf feed got. Muse picks shots; each shot scales a flat cut-out. | **No camera, no depth.** Everything sits on one plane, so nothing slides past anything. This is why it reads as "blinking frames". |
| Flat products in 3D | `server/product3d/prepare.ts` | Shape `other`: the cut-out's outline is extruded into a thick standee with its photo on the front. | The catalog throws it away (`prepareRound` keeps only can/bottle). |
| Stage3d set | `shared/aep/layer.ts` (stage3d `set`) | ground colour, a backdrop image on a wall, image **cards** at any depth, swarms. | Fog not supported. Nobody puts anything at depth. |
| Text motion | `engine/src/timeline/presets.ts` | glyphRise, glyphPop, glyphFlip, glyphWave (GSAP staggers). | Not reachable from the AEP path; our copy uses its own word-by-word keys. |
| User input | Catalog import | CSV only. | **No brief.** Muse never hears what the campaign is for ("summer holiday, beach, swim"). |

### Why there is no parallax

Parallax is near things moving faster than far things when the camera moves. It needs two things: a camera that moves, and things at different distances.

- The 2D board has neither: the "camera" is the product's own scale, and the background is on the same plane.
- The 3D film has a moving camera but nothing at distance: the backdrop is a flat 2D layer under the 3D world, so it never moves with the camera.

In three.js, parallax costs nothing once the set has depth: the camera moves and the engine's perspective does the rest. No extra keyframes. This matters because a world layer allows at most 64 tweens.

## The plan

One direction: **every product films in the 3D world**, flat ones as extruded cut-outs. The 2D board stays only as the fallback when a 3D build fails. The work is done in phases, each checked on frames before the next starts.

### Phase 0: the brief (input)

- Catalog import gets a **brief** box next to the CSV ("Summer holiday sale, beach, surf, swim, bright and fast").
- The brief goes into every Muse board prompt and the line film, the same way the crew already passes it (`boardPrompt({ brief })`).
- Optional per-row `brief` column in the CSV for one product.
- **Check:** two runs of one feed with different briefs give different concepts and tones. Cost: $0.005 per product per run.

### Phase 1: one 3D path for every product

- `prepareRound` becomes `prepareProduct`: round packs wrap their label as now; everything else uses the extruded outline (`shape: 'other'`), or a lit card when the outline is too thin (a towel, goggles).
- The catalog hero uses the cinematic board (`beatsheet.ts`) and `cinematic-film.ts`, not `board-clip.ts`. The board already has concept, elements, angles, product moves and cuts.
- The product's size, turn and drop work for a flat standee (a standee turns at most about 35°, so its edge never faces the lens).
- **Check:** all 5 surf products build in 3D; no error rows; frame strips show the board turning in the light.

### Phase 2: the set (depth, the main cause of "static")

New board field `set`, picked by Muse from a short list. The assembler places the planes; Muse never gives coordinates.

| Word | What the assembler builds |
|---|---|
| `backdrop` | the look plate or a stock photo, as a card far behind (about 3 m) |
| `ground` | a floor colour or texture under the product (sand, wood, stone, water-blue) |
| `midground` | 1–2 element cards between the product and the backdrop (a wave, a palm, a beach ball) |
| `foreground` | 1–2 element cards close to the lens, soft from the depth of field (spray, leaves, a towel edge) |
| `atmosphere` | swarms at three depths: dust, bokeh, droplets, sand |

- Rules for Muse: three depth planes at least in every wide and medium shot; foreground pieces never cover the product; the last shot (the price hold) keeps only the backdrop and atmosphere.
- Elements come from what Muse already lists (`elements`); set pieces reuse them, so no new image calls. A line film shares its pieces across its products.
- **Check:** frame difference between two frames 0.2 s apart is clearly higher on far vs near planes (measured, see Phase 6); visible parallax in strips.

### Phase 3: the camera (expose the rig)

- Extend the AEP stage3d camera with the engine's rig: `truck`, `pedestal`, `pan`, `tilt`, `roll`, `dolly`, and the `handheld` and `orbit` presets. Wire them in `web/src/motion/aep/stage3d.ts` to the engine's existing rig (no new engine code). Add an animated camera target.
- New moves in the board vocabulary, sized from the corpus craft notes:

| Move | Meaning | Size (from corpus) |
|---|---|---|
| `push` | in on the product | hook 40–90 %, else about 25 % |
| `pull` | out, the reveal | once per film |
| `truck` | slide sideways past the set (the strongest parallax) | about a third of the frame |
| `crane` | rise or fall while looking at the product | |
| `orbit` | swing round the product | 30–45° |
| `whip` | fast pan with a braking tail, into a cut | ends at peak speed |
| `dolly-zoom` | the vertigo reveal | once, late |
| `rack` | focus moves from a foreground piece to the product | |
| `handheld` | small living shake over any move | on by default, small |

- Rules: never the same move on two shots in a row; the hook is already moving at frame 0; a hold still drifts.
- **Check:** every shot has measurable camera motion (no frame pair 0.2 s apart is near-identical, except the price hold's text).

### Phase 4: cuts that carry motion

- A shot enters already moving in the direction the last one left (the craft rule "cut at peak velocity").
- `whip` cut: the outgoing shot pans fast, the next one enters with the same pan direction and brakes.
- `flash` cut: a 5-frame bloom straddles a push.
- Light sweep: the key light runs across the product in the peak shot (the 3D film already moves the key light; Muse gets to place it).
- **Check:** at each cut, the frame before and after both show motion in the same direction.

### Phase 5: copy that moves with the film

- Expose the engine's glyph presets (glyphRise, glyphPop, glyphWave) to the AEP text path, or match them in our word-by-word keys.
- Muse may place one short line of copy per film outside the end card (`text` already exists on shots); the end card keeps price, name and brand.

### Phase 6: the rule book and the checks

- One file, `server/authoring/cinematic-rules.ts`: every word of the vocabulary with a one-line meaning, and every rule with a number from the corpus. The board prompt, the checker and this doc all read from it, so they never drift.
- A **motion check** on rendered frames (headless capture already exists in `debug/surf/hero-shots.mjs`): for each shot, the mean pixel change between frames 0.2 s apart. A shot below the floor is flagged "static". This turns "is it a film or blinking frames?" into a number we can test.
- The critic gets the same frames for its read.

## Order and time

| When | Work |
|---|---|
| Nov 2 (rest of day) | Phase 0 and Phase 1; frames on the surf feed. |
| Nov 3 morning | Phase 2 (set and depth); frames. |
| Nov 3 afternoon | Phase 3 (camera rig exposed, new moves); frames. |
| Nov 3 evening | Phase 6 motion check; Phase 4 if time. |
| Nov 4 | Phase 5 only if everything above passes; final surf run; no new features. |

Each phase ends with a frame strip on the surf feed and the motion numbers, shown before the next phase starts.

## Cost

- Re-cutting from saved boards: $0.
- A new board per product (when the vocabulary changes): about $0.005, so about $0.025 for the 5 surf products.
- Element pictures (Muse Image + SAM): the larger cost; we ask before any run that draws new ones. Stock photos (Pexels, Pixabay) can stand in for backdrops at $0.

## Open questions

1. Flat products: extruded standee (has thickness, catches light) or a lit card (thinner, safer for towels)? Plan: standee by default, card when the outline is very thin.
2. Rig in the AEP path vs keys sampled by the assembler: the rig is less code and keeps under the 64-tween limit. Plan: rig.
3. Does the 2D board stay for anything but fallback? Plan: the tile stays 2D (fast wall preview); the hero film goes 3D.
