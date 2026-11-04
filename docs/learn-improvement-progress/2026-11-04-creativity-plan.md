# Why every film feels the same, and a plan to fix it (2026-11-04)

Plan only. No code changed yet.

## What makes films look alike

Three kinds of cause. Most of it is how Muse is asked, not what it may choose.

### 1. The prompt pushes Muse toward one look

- The board prompt opens with "the real product in a **dark, moody world**"
  (`server/authoring/beatsheet.ts`, `boardPrompt`). Every film starts from the same mood.
- The prompt names one "right answer" for several choices, and Muse copies it:
  - "teal shadows with orange highlights is the cinema look" (grade)
  - "a warm key with a cold teal or magenta rim is the classic commercial look" (lights)
  - the JSON template shows example numbers (`"depth?":0.95`, `"blur?":0.5`, `"bokeh?":0.4`, `"aperture?":0.3`).
- The worked boards from `referenceDeck()` are strong anchors, even with "do not copy".
- This explains the repeated grade (contrast 0.28, saturation 0.05, split 0.5, balance 0.1) with no
  such numbers in code.

### 2. Muse never sees what it made before

Each board is written fresh. Nothing tells Muse "your last three films were dusk + water + ripple cut".
At temperature 0.9 the model still falls back to its favourite answer for the same prompt.

### 3. Fixed values in code (the world scaffold)

| What | Where | Fixed to |
|---|---|---|
| Light preset | `cinematic-film.ts` ~1131 | `'studio'` always |
| Wall | `set-art.ts:146` `WALL` | distance 3.2, height 4 |
| Ground size | `CAMERA.groundSize` | 16×30 |
| Shadow softness | `cinematic-film.ts` ~1129 | 0.7 |
| Product body | `cinematic-film.ts:49` `SOLID` | depth 0.55, section 2.6 (photo on a rounded slab) |
| 2D choice | `crew/sheet-film/index.ts:65` | ignored, always built in 3D |
| Layer layout | `cinematic-film.ts` + `titles3d.ts` | world → product → elements → 3D title words + plate → air |

The older path (`crew/cinematic-cut.ts:365`) does keep the 2D film. The sheet-film path does not.

## Decisions (owner, 2026-11-04)

- **Only Step 1 (the prompt).** Muse makes every creative choice; code gives it tools and safety checks only.
- **Always 3D.** No 2D films. The 2D option is not a plan item.
- **Muse never sees old films.** No summary of past boards goes into the prompt.

## Step 1 — Unbias the prompt (done 2026-11-04)

In `server/authoring/beatsheet.ts` (`boardPrompt`):
- Opening line no longer says "dark, moody world". It lists many kinds of world, with no default.
- Lights: the "warm key, cold rim is the classic look" line is now a list of pairs, picked from the product.
- Grade: "teal and orange is the cinema look" is now a list of pairs, or none.
- JSON template: sample numbers (depth 0.95, blur 0.5, bokeh 0.4, aperture 0.3) are now ranges.

Checks: beatsheet and cinematic-rules tests pass (99), typecheck passes. Not yet checked on a live film.

## Still open inside Step 1

- The worked boards in `reference-deck.ts` lean dark (2 night, 1 sunset, 1 sky). Muse reads them as examples.
- The prompt still asks Muse to choose "3D or 2D" and explains 2D. With 3D always on, that text spends Muse's attention on
  a choice that is thrown away.

## Why 3D had less variety than 2D

The 2D film had a planning crew: the showrunner said the film in one sentence before planning, wrote a storyboard and a style
guide, sent each scene to its own builder, could make takes and pick one, and a critic sent scenes back. The 3D sheet film runs
none of it (`server/crew/run-crew.ts`, "no showrunner, no 2D crew"): Muse wrote the whole film in one JSON reply, from its first idea.

## The idea step (added 2026-11-04)

`server/authoring/pitch.ts`. Before the first board, one Muse call looks at the photo, pitches 3 films as different as 3 directors
would make (world, time of day, light, colour, pace, camera story) and picks one. The board is written from the chosen idea
(`boardPrompt({ idea })`). Revisions keep it because they start from the board.

- Muse makes every choice. The prompt only lists what the film can show, so ideas can be built.
- If the call fails or the reply has no idea, the board is written as before.
- The film log shows: `Muse pitched "A", "B", "C" and chose "B": why`.
- Cost: one more call, about $0.005. Time: one more Muse call before the board (not yet measured live).
- Tests: `server/authoring/pitch.test.ts`.
