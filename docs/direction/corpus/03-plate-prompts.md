# Plate prompts

A plate is the generated world behind the real product, made with Muse at about $0.01. This file is the grammar the plate-writing agent follows. It covers which slots go in what order, which words to use, and which words never to use.

## Slot order (order changes the result: subject and place first, style last)

```
[ASPECT + CAMERA] [SURFACE + where the empty space is] [PROPS at the edges] [LIGHT SOURCE: what, where, quality, time] [ATMOSPHERE: one airborne thing] [PALETTE FAMILY] [DEPTH] [NEGATIVES: instances, 4–6]
```

### Worked: tabletop hero, cold-brew can, 9:16

```
Vertical 9:16 photograph, camera at tabletop height, locked. A honed white marble counter fills the lower third, its centre left completely empty where an object will stand.
Coffee beans and a small glass of ice sit at the far left and far right edges, partly out of frame. Behind, a softly blurred cafe wall in warm plaster.
One large soft window camera-left, late-morning, so the counter is lit from the left and shadows fall short to the right. A thin haze of steam drifts across the back.
Palette of warm creams, espresso brown and soft brass. Shallow depth of field: the counter's front edge is sharp, the wall is soft.
No cups or cans in the centre, no people, no hands, no text, no labels, no logos.
```

### Worked: flat-lay party, 9:16

```
Vertical 9:16 top-down photograph of a styled party table. Pink linen cloth; the centre third of the frame is empty cloth.
Confetti, paper straws, a slice of cake and ribbon curls are arranged in a loose ring at the frame edges.
Soft overhead daylight, almost shadowless, high-key. Palette of saturated pinks, coral and gold.
No products in the centre, no people, no hands, no text, no labels, no logos.
```

### Worked: studio pedestal, serum bottle, 9:16

```
Vertical 9:16 studio photograph, camera at plinth height. A matte sand-coloured plinth at the lower third on a seamless clay backdrop; the top of the plinth is empty.
A glossy floor in front shows a faint reflection of the plinth. One large soft source above camera-left; the backdrop falls darker toward the right edge.
Palette of sand, clay and warm white. No bottles, no products, no people, no text, no logos, no lighting rig reflected.
```

## Words: replace, never use

| Never write | Write instead |
|---|---|
| cinematic | the camera height and the lens feel ("tabletop height, shallow depth of field") |
| moody / dramatic | the source and the falloff ("single window camera-left, the far side falls to shadow") |
| beautiful / stunning / gorgeous / masterpiece / award-winning | delete. Describe the light and the material it lands on |
| 8K / ultra-detailed / hyper-realistic | delete. Name the texture you want visible ("the grain of the oak") |
| atmospheric | one airborne medium: steam, haze, dust in a light shaft |
| epic | a scale cue ("the counter runs out of frame on both sides") |
| magic hour | "golden hour, low sun" or "blue hour, after sunset". The term is ambiguous |
| warm / cool alone | a named source: tungsten, late-morning window, overcast sky, neon |

## Light sources that survive generation

`late-morning window` · `low golden-hour sun with cool sky fill` · `overcast sky, shadowless` · `tungsten lamp` · `fairy lights as soft discs` · `blue hour, after sunset, practicals on` · `one large soft studio source above camera-left` · `hard sun raking low across the surface` · `neon magenta and cyan reflections`

Time-of-day traps: generators default to golden hour and to backlight. **State the side of the light** in every plate: camera-left or camera-right. The retail clip's shadow direction reads that side (`look.lightSide`), so the plate and the composited product agree.

## Negatives: instances, not categories; 4–6 items

- Always: `no text, no labels, no logos`. This is law 3.
- When the product stands in the centre: `no cups / cans / bottles in the centre`. Name the product's own class, so the model doesn't place a rival copy.
- Usually: `no people, no hands`.
- Glossy surfaces: `no lighting rig reflected, no window grid in the reflection`.
- Never write category negatives ("no modern objects"). They suppress nothing.
- If the tool has no separate negative field, phrase the constraint positively: write "the centre stays empty", not "no product".

## Composition contract with the layout engine

The plate must leave what `retailLayout` expects:

| Aspect | Where the empty surface must be | Where props may go |
|---|---|---|
| 9:16 | centre column, from ~45 % to ~75 % of height | edges, top 25 %, and blurred background |
| 1:1 | centre, from ~35 % to ~80 % | corners |
| 16:9 | left-centre third (product) **and** right third clear for the badge | far left edge, background |

If the plate check (vision pass) finds clutter in the product zone, regenerate once with "the centre ... is completely empty" moved to the first sentence. Then fall back to the stock plate for that category.
