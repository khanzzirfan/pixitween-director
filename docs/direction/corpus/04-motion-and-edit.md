# Motion and edit

These are the timing rules for our engine: keyframes in seconds, four eases, layers.

## Anti-slideshow (the slideshow feeling is made at the cut)

1. **Overlap motion across the cut.** Something moves in the last 0.4 s of shot A and something moves in the first 0.4 s of shot B, in the same general direction.
2. **Break size or angle big.** Consecutive shots differ by at least two size rungs (wide to close), or by a different look or angle. Never put two same-size, same-angle shots next to each other.
3. **One continuous music bed under everything.** Never re-trigger it at a cut. This does more than any picture fix. (`finish:music` already does this.)
4. **A move starts in A and finishes in B.** The badge starts its pop on A's last frames and lands on B's first.
5. **Vary shot length.** If three cuts in a row fall within 0.3 s of each other, it reads as a template. Use lengths like 2.6 / 1.8 / 3.2, not 2 / 2 / 2.
6. **Never open two shots in a row on a static frame.** If B starts still, give A a moving exit.
7. **Every shot has an end state.** Motion settles, holds, then cuts. Never cut mid-ease unless it is a deliberate whip.

## Three motion layers per shot (fix for "it's just a photo with a zoom")

Every shot needs at least two of:
- **World:** plate drift or rotation, about 1–2 % over the shot, linear.
- **Hero:** the product lands, then the light sweeps across it. The product never rotates.
- **Air:** steam, confetti, dust, a foreground blur sliver, or bokeh discs drifting.

## Timings that read as expensive

| Element | Keys | Ease |
|---|---|---|
| Plate drift | x 0 → −1.5 % W over the whole shot | linear |
| Product land (tabletop) | scale 0.92 → 1.0, 0.0–0.7 s, base held | easeOut |
| Product drop (flat-lay) | scale 0 → 1.06 → 1, 0.5–0.9 s | easeOut, then easeInOut |
| Hold push | scale 1.0 → 1.04, 0.7 s → end | linear |
| Light sweep | soft screen band from 12 % to 88 % of the pack's width, 1.1 s from about 1.1 s, opacity 0 → 0.55 → 0 | easeInOut |
| Price pop | 0 → 1.18 peaking on beat 2 (1.0 s at 120 BPM) → 1, then a 1 → 1.1 → 1 pulse peaking on every second beat | easeInOut |
| Name and subtitle | opacity 0 → 1 plus 12 px rise, 1.0–1.4 s | easeOut |
| Brand chip | opacity 0 → 1, 0.6–1.0 s | easeOut |
| Rack focus | plate blur 0 → 6, product blur 6 → 0, 0.8 s | easeInOut |
| Badge slam (promo) | scale 1.4 → 1, 0.25 s | easeOut |
| Strike-through | line scaleX 0 → 1, 0.3 s, left anchor | easeOut |

**On the beat:** with the 120 BPM bed, beats fall every 0.5 s. Land the price pop at 1.0 s and the pulses at 2.0, 3.0 and so on (whole beats), not at 1.8 s plus 1.2 k. If the bed tempo changes, pass `bpm` to `buildRetailClip` and `pulseKeys` moves with it.

## Pacing

| Register | Average shot | Longest hold |
|---|---|---|
| Retail tile | 1 shot, 4 s | — |
| Product sell (15–30 s) | 0.8–2 s | 6 s (the product hold) |
| Feed or vertical | 0.7–2 s (0.7 is the floor) | 3 s |
| Short film (< 3 min) | 2–5 s, with a hero moment about 2/3 through | 8 s |

## Sound (sell texture, one hit)

- One bed, ducked about 6 dB under any voice.
- **One hit** on the price or logo: a pop, chime or stamp. Not a hit on every element.
- Texture sounds sell the product: a can crack, a pour, a cup clink. Use them when the look has them.
- Sound-off legibility: the price and name must read without audio.
