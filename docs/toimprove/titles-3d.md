# Glossy 3D titles in the 3D film (2026-11-04)

Every word in the 3D film is real 3D type: extruded, bevelled letters with a glossy surface that catch studio light and reflections.
The flat text layers, their drop shadows and the flat pills are gone from the 3D film. The 2D crew film keeps its flat text for now
(it stays as the fallback until it is removed in a later step).

## How it is built

- **A second stage world, `cine:titles`**, sits over the product world. It has a fixed camera (fov 30, 10 m back), no floor and no
  wall, studio light with a reflection environment, and PBR shading. Screen pixels map to its z = 0 plane, so a title can be placed
  where the old flat text was.
- **Text is a prop with a new source, `text3d`** (shared/aep/layer.ts): text, font asset, size (world units, about the cap height),
  depth, bevel, align, line height, letter spacing, and an `enter` / `exit` that animate the letters one after another
  (rise, pop or flip in; fade out). The adapter (web/src/motion/aep/stage3d.ts) turns it into the engine's `text3d` object and
  per-letter tweens (`glyphs:<id>` with a stagger).
- **Plates and the price** are props too: a pill or bar is a rounded box behind the words that grows in from its centre, a disc is a
  coin (a short cylinder facing the lens), a tag is a rounded box. The price pulses by scaling the coin and its numbers together.
- **Fonts**: three.js's own MgOpen typefaces in web/public/fonts (Helvetiker, Optimer, Gentilis, bold and regular). Their letter widths
  are baked into server/authoring/title-metrics.ts for layout. A font asset of a `*.typeface.json` now reaches the engine.

## What Muse still picks

The end card's plate (pill, bar, none), price shape (disc, tag, plain), alignment, case, weight and accent, as before, plus
`endCard.face` (sans, soft, serif: Helvetiker, Optimer, Gentilis), `endCard.letters` (gloss, chrome, gold, satin) and `endCard.entrance`
(rise, pop, flip). The words themselves are Muse's, as before.

## Limits

A stage world holds at most 12 props: brand, name, tagline, two shot lines, price, old price (7 texts), three plates, the coin and the
strike line make 12 at most.

## Library choice

- troika-three-text: flat SDF quads, no depth or bevel. It loads any TTF/OTF/WOFF, which is its strength, but it cannot make "not flat".
- Imagineer99/Three.js-3D-Text: a demo app, not a library.
- countertype/three-text: MIT, extruded meshes, HarfBuzz kerning, any TTF/OTF/WOFF2, good line breaking. Alpha ("API may break rapidly"),
  needs a HarfBuzz wasm served, merges a line into one mesh (per-letter motion is a custom shader), no bevel found.
- Chosen: the engine's own `text3d` (three's TextGeometry, already wired, tested, seekable for export): bevels, physical materials, letters
  animated one by one on the film's timeline. three-text is the upgrade path for kerning and Google fonts, inside the engine's glyph builder.

## Titles harness

`npx tsx scripts/titles-harness.ts --title ... --price ... --brief ... --render` asks Muse for a board (or `--board` replays a saved one),
prints what Muse chose for the words, builds the film as the pipeline does, keeps only its words, checks the layout and renders a contact
sheet (data-s-titles/<out>/titles-sheet.jpg). It found, on its first runs: a late tagline whose letters ran past the film's end (the engine
refused the whole film, so it never drew: the adapter now fits the letters in), a short shot's line still arriving at the cut (letter
timing now fits the time a line is shown), a name wrapped "Wild Berry Greek / Yoghurt" (two lines now split evenly), beige letters under
the board's warm key (the titles have a neutral light of their own), gold and chrome that went black (part metal over a bright base now),
and a plain price off the frame's edge (blocks are moved inside the frame).

A full pipeline run (cold brew can, Muse kept the 3D cut) drew every title over the real can. Its frames showed one more thing: on a
0.8 s shot the line spent its whole time arriving and leaving ("STAY COLD" was whole for about one frame). A line's exit now takes at
most a third of its rest (`titleExit`, `titleLeaveAt` in titles3d.ts); the layout and the letters use the same numbers.
