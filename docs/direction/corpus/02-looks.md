# Looks

A **look** is a full recipe for one shot: the world, its light, the camera, motion, grade, type and sound. The director picks one per product (or per category) first. Everything after that is deterministic.
The code version is [`server/authoring/looks.ts`](../../../server/authoring/looks.ts): recipes, plate templates, occasions and `pickLook`. Keep the two in step.

How to pick: use the product's **material** (the table below) and the **occasion** in the brief. Within one catalog wall, vary the looks per category so the wall doesn't look stamped.

## 1. Tabletop hero, the default for food and drink

- **World:** an eye-level, three-quarter view of a real surface: oiled oak, honed marble, linen cloth. One or two ingredients that tell the flavour sit at the edges, never in the centre third. The background falls off 1–2 m behind.
- **Light:** a large soft window camera-left, late-morning, warm-neutral. A short soft shadow falls camera-right.
- **Camera:** locked, product at its own eye level. The 85–100 mm feel comes from a soft background.
- **Motion:**
  - The plate drifts 1.5 % left.
  - The product lands with scale 0.92 → 1, base held on the table.
  - A highlight sweep travels left to right over 1.2 s.
  - A foreground blur sliver (a leaf, a glass rim) slides right, faster than the plate.
- **Grade:** warm highlights, gently lifted blacks. Use at most two grade words.
- **Type:** price disc in the free side. Slim name below.
- **Sound:** a warm acoustic bed and a soft wooden "tock" on the price.
- **Fits:** cans, bottles, jars, coffee, bakery, sauces.

## 2. Flat-lay, the graphic look (the supermarket reference)

- **World:** top-down styled table. Props sit in a ring around an **empty centre**: confetti, napkins, ribbon, ingredients. Use a brand-adjacent palette family.
- **Light:** soft overhead daylight, almost shadowless, high-key.
- **Camera:** locked overhead on the plate. The product is a front-on **card**: a cut-out with a lifted drop-shadow (distance 18–26, soft), so the float reads as deliberate style.
- **Motion:**
  - The product drops in with a soft overshoot: scale 0 → 1.06 → 1 at 0.5–0.9 s.
  - The plate rotates about 1.5° over the clip.
  - Confetti or petal layers drift down slowly.
- **Grade:** clean and bright, saturated accent colours.
- **Type:** the price badge can sit anywhere in free space. Brand chip in a corner.
- **Sound:** a playful pluck or marimba bed and a pop on the price.
- **Fits:** party, gifts, kids, bakery, snacks, seasonal promos.
- **Rule:** never mix a front-on cut-out with a top-down plate *without* the lifted shadow. That mix is what made the bottle look "floating".

## 3. Studio pedestal, the premium look

- **World:** a seamless backdrop in one colour family, a plinth or stepped blocks, and a gloss floor that shows a soft reflection.
- **Light:** one large soft source above camera-left, with a hard edge kicker camera-right that draws a rim. The background is a *value*, not a place.
- **Camera:** locked at product eye level.
- **Motion:**
  - A rim glint sweeps the edge.
  - Slow push 1 → 1.03.
  - The reflection layer is the product flipped vertically, at opacity 0.18 with a fade mask. This is the only allowed flip, and it is the reflection, not the product.
- **Grade:** crushed blacks, rolled-off highlights.
- **Type:** small serif or thin sans with wide tracking. Price in a slim pill, not a disc.
- **Sound:** a low synth pad and a soft chime.
- **Fits:** cosmetics, perfume, gadgets, watches, premium spirits.
- **Material rules:**
  - *Glass:* choose dark field (bright edge lines on black) or bright field (dark edges on a lit panel). Don't mix them.
  - *Metal or gloss:* light what it reflects, a soft rectangle.

## 4. Lifestyle room, the home look

- **World:** a real room, a shelf or a kitchen counter, with a bokeh window behind. Practical lights such as a lamp or fairy lights read as soft discs.
- **Light:** motivated by the window. Warm tungsten practicals against cooler daylight.
- **Camera:** locked at counter height.
- **Motion:**
  - A **rack focus**: the plate starts sharp (blur 0) and goes soft (blur 6) while the product goes from soft to sharp, over 0.8 s.
  - Then hold. Steam or dust drifts.
- **Grade:** warm-neutral skin tones, a soft halation on the practicals.
- **Type:** handwritten-feel accent plus a clean price.
- **Sound:** room tone, a soft bed and a cup "clink".
- **Fits:** mugs, candles, home goods, tea, cosy seasonal items.

## 5. Ingredient orbit, the energy look (the can reference)

- **World:** a colour field from the flavour palette (citrus yellow, berry magenta). No surface.
- **Light:** a bright front-biased key and a strong rim to separate the edges.
- **Camera:** locked, with the product centred.
- **Motion:**
  - Ingredient cut-outs (generated, defocused, never branded) orbit on 2–3 depth rings. Near rings are larger, blurred and faster; far rings are small, sharp and slow.
  - A splash burst on the beat (0.9 s) as scale 0 → 1.2 with an opacity fade.
- **Grade:** high saturation and contrast.
- **Type:** bold, flavour name huge, price in a burst shape (polystar).
- **Sound:** an upbeat bed, a whoosh on the orbit and a pop on the burst.
- **Fits:** soda, energy drinks, snacks, juice, candy.
- **Risk:** splashes and liquid are physics. Use pre-made splash stills animated as layers, never one generated pour.

## 6. Price promo, the loud look

- **World:** a bold brand-colour field with diagonal stripes or rays (shape layers).
- **Light:** flat, graphic.
- **Motion:**
  - The badge slams in (scale 1.4 → 1, 0.25 s, easeOut).
  - The old price gets a strike-through line drawn left to right.
  - The new price pops, then pulses on every beat.
  - Cut on the beat.
- **Type:** the price is the hero, the product is second (smaller, at a corner third).
- **Sound:** a punchy bed, a stamp hit on the badge and a cha-ching on the new price.
- **Fits:** sale variants (`salePrice` set), clearance, multi-buy.

## Material → light

| Material | Light it like this | Plate prompt clause |
|---|---|---|
| Gloss / metal / lacquer / can | Light what it *reflects*: one large soft rectangle, dark negative side | "one large soft window camera-left, the far side of the frame falls darker" |
| Glass / liquid / bottle | Edges and background, never the object. Use dark or bright field. | "a softly lit pale wall behind, so glass edges read dark against it" |
| Matte: paper, box, fabric, cream | **Raking** low-angle hard light, so texture casts short shadows | "low sun raking across the linen from camera-left, short crisp shadows" |
| Food | Keep it whole and uncut. Motion goes in the steam: say where it starts and which way it drifts. | "steam rises from the cup at left and drifts right" |

## Product shape → layout

| Shape | Pack fill | Badge | Notes |
|---|---|---|---|
| Tall (can, bottle; aspect < 0.5) | 46 % of window height in 9:16 | Right free side | The tabletop or pedestal looks shine here. |
| Square (jar, mug) | 0.6 of window width | Top-right | Flat-lay works well. |
| Wide (box, bar, tray) | 0.6 of width | Above, or top-left | At 9:16, use the flat-lay or a tighter tabletop. |
| Multi-pack | Treat as wide | Corner | Price promo look. |

## Occasion → palette family (the prompt only asks for the family; the hex comes from the brand)

| Occasion | Props | Palette family | Time of day |
|---|---|---|---|
| Everyday or breakfast | linen, wooden board, fruit | warm creams, honey, sage | late morning |
| Summer | ice, citrus, sun-bleached wood | bright whites, sky, citrus | midday (short shadows) |
| Party | confetti, streamers, cups | saturated pinks, golds | high-key studio |
| Festive or winter | pine, ribbon, fairy lights, wool | deep green, red, warm gold | blue hour plus tungsten practicals |
| Wellness | stone, eucalyptus, water | pastel sage, sand, clay | overcast (shadowless) |
| Premium or night | marble, brass, dark velvet | black, gold, oxblood | studio low-key |
