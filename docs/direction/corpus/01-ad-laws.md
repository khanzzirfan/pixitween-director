# Ad laws

These are the rules every product clip and film follows, whatever look it uses. Each rule says what to do, why, and how it maps to our engine.

## The ten laws

| # | Law | Why | In our engine |
|---|---|---|---|
| 1 | **One claim per clip.** Before planning, say what the viewer must repeat afterwards: the product, its price, and one fact. | A beauty shot with no claim is the classic amateur mistake. If the viewer cannot repeat the claim, the spot failed however it looks. | The storyboard has one `claim` line. In a retail clip the claim is name + price. |
| 2 | **Composite the real product. Never generate it.** Generate the world and the light, and lay the real cut-out over it. | Generators drift the logo, the proportions and the brand hue on every clip, and the drift shows at the cut. | Plate = Muse image. Product = SAM cut-out `image` layer. A generated product is allowed only as a defocused background prop. |
| 3 | **Never generate readable type.** The name, price, claim and logo are all graphics. | Type-shaped marks fail on inspection, and fail differently every time. | Every plate prompt ends `no text, no labels, no logos`. All words are `text` layers. |
| 4 | **The light moves; the product never turns in 3D.** Motion comes from a travelling highlight, the world, push-ins, and in-plane tilt or tumble entries. | Turning the product in 3D means re-deriving its geometry, which is what breaks. A travelling highlight is only a gradient. Tilting a flat cut-out in the picture plane keeps the label intact, and the reference ads use it for energy. | A soft screen-blend band travels across the pack (`look.sweep`). Push 6–10 % on the hold. Tilt entries of up to ±25° that settle upright are allowed; never squash or 3D-turn the cut-out. |
| 5 | **Ground the product.** It stands *on* something, at its own eye level. A contact shadow touches its base, and the shadow falls the same way as the plate's light. | Floating reads as pasted-on. Eye level is the product genre's default camera. | The plate prompt asks for an empty surface in the lower third. `retail-clip` uses the table base, an ellipse contact shadow, and a drop-shadow direction taken from the look's light side. |
| 6 | **Three depth planes.** Foreground sliver (blurred), product, background (soft). Each moves at its own speed. | Only two planes is the named failure of deep staging. Parallax is the cheapest cinema cue we have. | A foreground blur prop layer (z < product) drifts 2× faster than the plate. The plate gets a gaussian-blur of 2–6 so the product is the sharpest thing. |
| 7 | **One dominant move per shot.** Pick push-in, drift or rack. Never stack two. | Two moves read as drift or oscillation. | Per scene, one camera intent: `push` (scale 1→1.04), `drift` (x ±2 %), or `rack` (blur swap). |
| 8 | **Name the source, not the mood.** "Large soft window camera-left, late-morning" not "moody, cinematic, stunning". | Mood words come back as the training-set average. Source words carry direction, quality, colour and era. | Plate prompts are built from slot templates ([03](03-plate-prompts.md)). The banned words are listed there. |
| 9 | **Brand colour is graded, not requested.** Take the hue from the brand hex: the frame, badge ring and grade tint. | A generator never lands exactly on a hex, and never on the same value twice. | `accent` drives the badge ring, frame and soft-light tint. The plate prompt only asks for a palette *family* ("warm creams and terracotta"). |
| 10 | **Quiet type, loud price.** One loud element per frame, which is the price. The name is slim and small with air around it. | Hierarchy: a clip that shouts everything says nothing. | Price is weight 800 on a disc. Name is weight 400–500, ≤ 2.2 % of H, over a soft fade. |

## Format rules (delivery outranks genre)

- **9:16 vertical is a different grammar, not 16:9 turned sideways.** Stage in depth, not side by side.
  Go one shot size tighter than you would at 16:9. Keep nothing load-bearing in the top ~12 % or the bottom ~20 %, where platform chrome sits.
  The retail clip's caption zone sits above that bottom band.
- **Centred is correct in 9:16.** A single subject with nothing pulling it off-frame is centred. Rule of thirds is for 16:9 lifestyle frames.
- **1:1 forces centring.** Badge and brand go in the corners. **16:9** gives the badge real side space: product at the left third, badge and copy on the right.
- **Generate plates natively at the target aspect.** Never crop a 16:9 plate to 9:16.

## Structures by length

| Length | Beats | Notes |
|---|---|---|
| **4 s retail tile** | 0–0.6 world settles · 0.5–1.0 product lands · 0.9 price pops (on the beat) · 1.0–1.4 name fades in · hold with one light sweep | One shot. This is what the Catalog Crew stamps per product. |
| **6 s pre-roll** | 0–0.8 hook (product already big, light already moving, no logo) · 0.8–2.5 one visible fact (texture or detail) · 2.5–4.5 claim (type over picture, product back to hero size) · 4.5–6 end card | No build-up. Hook in the first frame. |
| **15 s feed** | 0–1.5 hook (product visible by 1.0) · 1.5–3 first visible change · 3–7 demo, 2–3 shots cutting every 1.2–2 s · 7–9 second change · 9–12 claim · 12–14 packshot · 14–15 end card that answers frame one (loop) | A change by 3 s is the retention checkpoint. |
| **30 s spot** | 5 s hook · 18 s demonstration · 4 s claim · 3 s end card | Shot length 0.8–2 s for a sell, longest hold 6 s (the product hold). |
| **< 3 min film** | Hook → 3–6 scenes → hero moment about 2/3 through → end card that answers the opening | Each scene still obeys the laws above. |

## Hard nos

- Squashing, mirroring or 3D-turning the product cut-out: the label and logo break. A floor reflection is the only allowed flip. In-plane tilt is fine.
- A generated hand gripping the branded product.
- A pour, splash or articulation (lids, hinges) as one continuous generated shot. Cut around it: bottle tilting, then the filled glass.
- Teal-and-orange by default. It costs nothing and says nothing. Pick a palette that tells where we are.
- More than two grading words in one prompt. Filter collapse turns everything to beige soup.
- Two adjacent shots of the same size and angle (slideshow).
