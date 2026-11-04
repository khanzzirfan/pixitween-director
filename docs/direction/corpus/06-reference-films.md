# Reference films

These are lessons from thirteen product ads the user collected (eight first, five dairy and frozen ads added 4 Nov 2026). The films live in `debug/movies/`, which holds per-film `direction.md`, `shots.json`, a contact sheet and frames, plus a cross-film `LEARNINGS.md`. The measurements come from `debug/movies/_tools/analyze.py`. I checked the readings against the contact sheets by eye.

Seven of the films are AI or CG 3D renders: lemon soda, a chocolate tube, a snack pouch, a seasoning shaker, an iced-coffee sachet, a latte can and yogurt. One is a flat 2D motion graphic (a sports drink, "Tevia"). **Tevia is the closest match to our engine**, which works with layers, keyframes and cut-outs. The others show what to fake with layers.

## What they all share (measured)

| Pattern | Numbers | In our engine |
|---|---|---|
| Hook in under 1 s, kinetic, the lens inside the action | push 40–90 % over the first 1.4–2.3 s | **Yes.** Plate and air layers scale 1 → 1.5 behind the product, or an air layer fills the frame. |
| **Push-in is the default move** | about 70 % of shots. A pull-out is the reveal or payoff, used once or twice. Pans of 15–35 % ride along with pushes and almost never happen alone. | **Yes.** Our hold push of 4 % is too timid. Use 6–10 % on the hero hold, and 5–16 % ease-out on the final shot. |
| The cut rate speeds up, then stops | middle shots 0.4–1.0 s; the last shot holds 1.2–5.4 s, which is **12–37 % of the runtime** | **Yes** (scene lengths). The end hold carries the price and the call to action. |
| Scale story | tiny product in a big world → macro on the label → full hero. Going from tight to wide is the payoff. | **Yes.** A *label macro* is just the cut-out at 2.5–3.5× centred on the label, then a pull to the hero. No new asset needed. |
| Eases | pushes into the product ease out; fly-throughs and whips are linear; an accelerating push only when leaving into a cut | **Yes**, all four of our eases. |
| The light recipe stays, the colour changes | one key from the upper left, a rim on the product edges, a floor reflection on the hero end; variants swap hue only | **Yes.** Keep the look and swap the plate hue or field colour per variant. |
| Subject locked, world moves | a swirl, ring or rays rotating around a product that stays the same size | **Yes.** Rays (price promo) and a halo exist; a rotating ring of ingredient cut-outs needs the assets. |
| End | every film ends on a 1.2–5.4 s hold, usually easing out | **Yes.** |

## Per-film devices worth stealing

| Film | Device | Timing | Layer version |
|---|---|---|---|
| Latte can (low-key black) | **Amber halo** behind the can; the product is the only bright object, so the camera hardly moves. The material around it changes every ~2 s (milk swirl, ice, smoke, powder) while the light stays the same. Wide and macro alternate, never more than two of the same size in a row. | 9 shots, average 1.9 s, **5.4 s final hold** | Halo = a blurred accent ellipse behind the pack, breathing in opacity. "Material changes" = swapping air layers per beat. |
| Latte can, Tevia | **The product tilts and tumbles in the frame plane** (10–45°) and then settles upright | entries 0.3–0.6 s | **Yes, and safe.** Tilting a flat cut-out in the picture plane never breaks the label. Law 4 bans *3D* turning, not tilt. |
| Tevia (flat 2D) | **One claim per colour field.** Scale pops of 30–75 % and a 2–3-frame whip blur between fields. Bottles tumble through frame at several scales *around fixed text*, then line up. Text types in word by word with the key word bold. | 11 segments; claims held 3.6 s; **tagline hold 3.7 s** | **Yes, all of it**: shape fields, the `directional-blur` effect on a fast x-slide, text per word, product lineup on a floor band. |
| Yogurt (3 flavours) | **One grammar repeated per variant:** colour swirl (wide) → the cup drops in with a splash → push 50–100 % to the label. Each act is colour-coded, and the backdrop *is* the colour. Then an overhead lineup summary and an end card. | about 2.1 s per act; the end card is the longest shot (4.3 s of 15 s) | **Yes.** This is the catalog-variant film: same pose, plate or field recoloured per variant, drop-in with overshoot, push to label. |
| Snack pouch (2 flavours) | **Variant match cut:** the same pose and camera; colour and burst direction change | 1.0 s average | **Yes.** Cut on an identical pack transform and swap the field colour and rays. |
| Seasoning shaker | **A particle cloud as the transition:** push into the spice until it fills the frame, then cut inside it. **Montage grammar:** one gesture per item at 0.4–0.7 s, then a wide "abundance" payoff with the product raised, and a 1.8 s hold. | 100 % push-in, 10 of 10 shots | Partly. The cloud = air layer scale 1 → 3 at about 0.6 s, then cut. The montage needs per-item plates (one Muse plate each, about $0.01). |
| Iced coffee | **One warm accent in a cold world.** A droplet match cut: a small object travels down the pack into the next scene. Immersion macro (inside the liquid) as the sensory peak at 55–65 % of runtime. | 0.8 s average; 3.2 s end pull-out | Cold plate + warm grade only on the product (a tint on the pack layer). The droplet and immersion need generated clips. |
| Chocolate tube | Fastest cuts (0.67 s average). **Label macro, then pull to the tube.** Ends on the slowest, steadiest shot. Low-key warm palette, backlit gold particles, floor reflection. | 15 shots; 1.2 s hold | Label macro: yes. Gold dust = warm bokeh air. |
| Lemon soda | Establishes the world with a long forward move through foreground objects (lemons wipe the lens), reveals the product *small* on the horizon, then brings it close. The end mirrors the opening so it loops. | 22 s; +90 % dolly over 2.2 s | Foreground wipes = large blurred cut-outs crossing fast in front (z < product). |

## Batch 2 (4 Nov 2026): yoghurt and ice cream

Five more ads, all dairy or frozen: Frambini (raspberry cup, AI, 20 s), Tude (2D, 15 s), milma (2D, five flavours, 18 s), noosa (6 s, 4:5) and Cream Stone Tubz (mango, 25 s). Per-film notes are in `debug/movies/<slug>/direction.md`; compact data is in `films/`.

| Film | What it does | Timing | In our engine |
|---|---|---|---|
| **milma ice cream** | **Ring-tunnel variant film.** Two-tone concentric rings in the flavour colour. The white cup tumbles in, ingredient cut-outs sit in two opposite corners, the flavour name pops above, then the cup shrinks to the ring centre and the next colour's rings take over. After five flavours: lineup with a headline, then a logo on white. | Each act 3.0 s (0.64 s in, 2.36 s hold); lineup 1.8 s; logo 1.2 s | **Yes.** This is R4 with a ring background and a shrink transition. The best match to `variant-film.ts`. |
| **Tude** | One pink blob behind the tub, fruit orbiting it, a tagline typed word by word, then a liquid splash wipes to a crimson end card with logo and tagline. A 16:9 ad inside a 9:16 frame, with blurred copies above and below. | 8.3 s drift, 3 s wipe, **3.7 s hold (25 %)** | **Yes.** Blob = a blurred ellipse in the field; the wipe = a 4-frame slide in the brand colour. |
| **noosa** | A 6 s film as three 2 s beats: fruit rain on a teal plate, the yoghurt surface with fruit landing in it, then a lineup with a large logo. A small logo bug sits in every shot. | 1.9 s, 2.1 s, 2.0 s | **Yes** as a 6 s pre-roll. Falling fruit = air layer cut-outs. The surface macro needs one plate. |
| **Cream Stone Tubz** | Hero, label macro with condensation, lid macro, ingredient macros, pulp filling the frame, round seal macro, lid peel, texture macros, whole fruit, hero pull-out, logo. Mostly static or pan. | 16 shots; 2.7 s logo hold | **Partly.** Label and seal macros yes (cut-out at 3×). Condensation and pulp need plates or clips. |
| **Frambini** | Four 5 s AI clips on one pink palette: flat-lay hero, ingredient dipped in chocolate, a person biting it, a cut-open bite with cream and chocolate ribbons spiralling round it. | 5 s per clip, all push-in | **No** for the person; the others are plates plus a push. The ribbons need a generated clip. |

### What batch 2 adds to our rules

1. **Dairy and frozen palette.** One hue family per film (pink, raspberry, cream), or one hue per flavour. The pack stays white or neutral and the backdrop carries the colour.
2. **Texture is the plate.** A yoghurt surface or an ice-cream swirl macro is the background fruit lands in. A pour or pulp filling the frame is a transition.
3. **Fruit moves, the product does not.** Falling, orbiting or corner cut-outs. Cheap with the air layer.
4. **Logo end card, brand-colour field.** Tude 3.7 s, Cream Stone 2.7 s, noosa 2.0 s, milma 1.2 s. One tagline line under the logo. For a 10 s film hold 2–2.5 s.
5. **Wet label macro.** Condensation droplets on the label or lid say cold and fresh.
6. **Interior reveal.** A cut-open product with ribbons of cream or chocolate round it is the payoff shot for sweet and dairy.
7. **Keep the real label.** AI clips redraw the pack and change the name (Frambini became Frami). Every shot that shows the label should come from the cut-out, not the generator.
8. **One palette keeps chained AI clips together.** Use the same colour words in every plate prompt.
9. **Short films are three beats.** 6 s: hook, surface macro, lineup. 10 s: hook, label macro, texture, fruit rhythm, hold.

## Fake dolly zoom (no real one appears in the set)

The nearest are a background spiralling or expanding while the subject holds (chocolate tube at 2.9–4.1 s), and a pull-back where the background shrinks twice as fast as the product (pouch at 6.6–8.1 s).

To fake it, scale the plate about the product's centre by +20–35 % over 0.3–0.9 s while the product layer holds its size. Use it once, at the reveal.

## What this changes in our rules

1. **Law 4, refined.** Never turn the product in 3D. In-plane tilt and tumble entries are fine, and they add energy.
2. **Push harder.** A hook push of 40–90 % on the world. Hero hold 6–10 %. Final push 5–16 % with ease-out.
3. **End hold = 12–37 % of the runtime.** A 4 s tile holds about 1.2 s after the last beat; a 15 s film holds 2–5 s.
4. **Catalog film grammar = the yogurt and Tevia pattern.** Per variant: field or plate in the variant colour → product drops in tilted and settles → push to label → match cut to the next variant. Then a lineup of every variant on one floor band with the tagline and price held 3–4 s.
5. **Alternate size.** Hero, then label macro, then hero. Never three of the same size in a row.

## Build list (layer-only, $0)

Status (31 Oct 2026): R1, R2, R3, R4, R5 and R6 are built in `server/authoring/variant-film.ts`. R5 is a 4-frame slide only, because the player does not implement `directional-blur`. R7 is not built. Demo: `npx tsx scripts/variant-demo.ts [aspect] [out.json]`.

R8 and a real 3D R1 are built in `server/authoring/hero3d-clip.ts` (the `hero-3d` clip): the product is a `model3d` can wearing the label unwrapped from the cut-out, so it can spin and turn. The dolly zoom is the engine's animated `camera.fov` (20 to 80 degrees over 1 s, engine 0.3.4): the camera re-frames the can at every fov, so it holds its size while the perspective deepens and the halo and bokeh grow by 1.35x. The light sweep is the key light running round the can (`lighting.key.azimuth`). Demo: `npx tsx scripts/hero3d-demo.ts [cutoutAssetId] [aspect] [out.json] [--sale]` (free, offline).

| # | Feature | From |
|---|---|---|
| R1 | `hero: 'tumble'`: enters at −20° plus scale pop 0 → 1.08 → 1, settles upright | Tevia, latte can |
| R2 | Label-macro beat: cut-out at 3× on the label for 0.8–1 s, then an ease-out pull to hero | latte can, chocolate tube |
| R3 | `halo` world: a blurred accent ellipse behind the pack, breathing opacity; pairs with a dark plate | latte can |
| R4 | Variant film: N variants × (colour field → tumble-in → push to label) with match cuts, then a lineup end card holding 3–4 s | yogurt, pouch, Tevia |
| R5 | Whip transition: 3-frame x slide plus `directional-blur` between colour fields | Tevia |
| R6 | Word-by-word text, key word bold or in the accent colour | Tevia |
| R7 | Air-cloud transition: the air layer scales to fill the frame, then cut | seasoning shaker |
| R8 | Fake dolly zoom on the reveal: plate +25 % about the product over 0.6 s, product held | chocolate tube, pouch |
| R9 | Ring-tunnel background: two-tone concentric rings centred on the product, scaled and rotated slowly; the shrink-to-centre transition between acts | milma |
| R10 | Blob wipe: a flat splash shape in the next field colour covers the frame for 4 frames, then the end card | Tude |
| R11 | Fruit rain / orbit: cut-out fruit falling or circling a fixed product (air layer) | noosa, Tude |
| R12 | Logo end card on a brand-colour field with a one-line tagline, held 2–3.7 s | Tude, Cream Stone, noosa |
| R13 | Landscape-in-portrait: blurred enlarged copy fills the top and bottom bands | Tude |
