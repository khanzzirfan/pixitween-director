# Critic rubric for product clips

The blind critic sees frames only, at 0.3 s, 1.0 s, 2.0 s and the last frame. Score each line pass or fail. Report at most two issues, worst first. Each issue names one fix from the Fix column.

| # | Check | Fails when | Fix |
|---|---|---|---|
| 1 | **Claim reads** | Name or price is unreadable on the last frame, or is not readable within 2 s with sound off | Raise contrast or the fade strip. Raise the price size. Move the badge into free space. |
| 2 | **Product is the sharpest thing** | The plate is as sharp as the product, or a prop draws the eye first | Add plate blur 2–6. Push the props to the edges. Regenerate the plate. |
| 3 | **Grounded** | The product floats: no contact shadow, the base doesn't meet the surface, or the shadow goes against the plate's light | Snap the base to the table line. Flip the shadow direction to `lightSide`. Use the flat-lay lifted shadow. |
| 4 | **Angle match** | A front-on product sits on a top-down plate without the card shadow, or vice versa | Switch the look, or regenerate the plate at tabletop height. |
| 5 | **Nothing covers the product** | The badge, brand or text overlaps the pack | Re-run `retailLayout` with the next slot. |
| 6 | **Plate is clean** | Generated text, a logo, a rival product or a person appears in the plate | Regenerate with that instance named in the negatives. |
| 7 | **Motion lives** | It looks like a still with a zoom: fewer than two of world, hero and air move | Add a light sweep, plate drift or an air layer. |
| 8 | **One loud thing** | The name, brand and price all compete | Name to weight 400–500 and smaller. The price stays the loud element. |
| 9 | **Brand colour holds** | The frame or badge colour fights the plate palette | Use the plate palette family nearer the brand hue. Lower the grade opacity. |
| 10 | **Safe areas** | Copy sits in the top 12 % or the bottom 20 % at 9:16 | Raise the caption zone. |

## AI tells (any one of these lowers the look score)

- A centred title on a gradient.
- Everything fading in together.
- Linear easing on entrances.
- Glows or particles with no source.
- A teal-and-orange grade by default.
- Mirror-perfect symmetry with nothing pulling the eye.
- A plastic-looking product from rotation or warping.
- Golden-hour orange haze on everything.
