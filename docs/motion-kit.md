# Motion kit: animation, transitions and looks for the crew

Status: requirements, 30 Oct 2026. Not built. The engine side is being built in `reacthub-pixitweenjs`; the Director side starts when an alpha is published.

## Why

The 30 Oct live run (`s13-3d`) produced a film that works but looks static: camera moves are tuned to 1.5 degrees of orbit, 8 % of pan and 15 % of dolly, scenes join with hard cuts and text only fades. The engine already ships 135 entrance, exit and loop presets, animated VFX filters, `postFx` (bloom, chromatic aberration, vignette, noise, lens blur) and text range selectors (chars, words, lines). The Director reaches none of them, so the demo does not show what the engine can do.

## Rules for this work

- **Meta only for the showcase.** The models are Muse Spark (builders), Muse Wonder (showrunner), Muse Image and SAM. There is no music, no sound effects and no speech in this work; Meta has none and the demo should not lean on another vendor.
- **The engine is never edited from this repo.** Everything below is either an engine ask (section A, built in `reacthub-pixitweenjs`) or Director work (section B).
- **Cheap models stay reliable.** The builder is the small model. It gets a short curated catalog, never the engine's full list.
- **No real brands** in any demo film or fixture.
- **Behind a switch.** `MOTION_KIT=true` turns the Director side on; off, every prompt and tool list is byte-identical to today (the same pattern as `PRODUCT_3D`).

## A. What the engine must provide

Each item has an id so ENGINE-NEEDS rows and tests can cite it.

| Id | Requirement | Acceptance |
|----|-------------|------------|
| M1 | **A machine-readable catalog**, exported from the package: every entrance, exit and loop preset, every scene transition, every look, every text effect and every camera move, each with `name`, `kind`, `defaultDurationSec`, `params` (name, type, range, default), `roles` it suits (bg, product, headline, caption) and a one-line `useFor`. Versioned with the package. | `import { motionCatalog } from 'reacthub-pixitweenjs'` returns it; it validates against its own zod schema; adding a preset to the engine adds it to the catalog with no second edit. |
| M2 | **Per-layer entrance, exit and loop in the composition JSON** (AEP layer schema), not only in the legacy `transformation` props. Set by name plus optional `durationSec` and `delaySec`. | A layer with `animationIn: BACK_IN_UP` passes the engine's schema, plays, and `Assets`/texture teardown stays clean over two scenes. |
| M3 | **Scene transitions** between two scene precomps: `kind`, `durationSec`, overlap at the cut. At least: crossfade, slide, push, zoom-through, wipe, one shader transition. Works with the existing automatic crossfade at hard cuts. | Played through a boundary in headless Chrome: both scenes visible during the overlap, no blank frame, no `alphaMode` error. |
| M4 | **Looks**: a film-wide or per-scene stack of `postFx` and animated VFX (light leak, film grain, vignette, bloom, chromatic wave) with an `intensity` 0 to 1. | Same film with and without a look differs by more than a set pixel difference; intensity 0 is identical to no look. |
| M5 | **Text effects** by name: typewriter, word by word, char stagger, line reveal. Parameters: `perUnitDelaySec`, `durationSec`. | Headline "Cold brew" with `word-by-word` shows 0 words at t=0, 1 at the first beat, 2 at the end of the effect. |
| M6 | **Camera presets with a strength range that reads on screen**: calm (today), push-in, whip pan, orbit at 8 to 15 degrees, parallax with visible depth. Strength is a number; the preset names appear in the catalog. | A 4 s scene at the energetic setting moves the product by more than 5 % of the frame width between t=0 and t=4. |
| M7 | **Frame-driven, not wall-clock.** Every effect above is a pure function of the timeline time, so seeking, capture and export give the same frame. | Seeking to t=1.5 twice, in any order, gives identical pixels; Pixi capture (used by the critic) and the in-browser MP4 export match the live canvas. |
| M8 | **Performance.** A 1080p, three-scene film with one look and one transition plays at 30 fps on the demo laptop. | Measured and recorded in the release notes. |
| M9 | **Schema exported and versioned**, so the Director's validator accepts the new fields. The logs currently say `reacthub-pixitweenjs/schema is not available; using the light composition validator`; the new fields must either be in that export or pass the light validator. | `lightValidate` and the engine schema both accept a composition using every field above. |

Out of scope: audio of any kind, 3D changes, new generate-mode behaviour.

## B. What the Director adds once the engine ships

The swarm learns through tools and prompt text only (there is no skills or MCP layer in the loop).

1. **Generate from the catalog.** Tool enums and the prompt block are built from `motionCatalog`, so a new engine effect teaches the swarm with no code change here.
2. **Tools** (authoring layer, the same shape as `setCamera`): `animateLayer(layerId, in?, out?, loop?)`, `setTransition(sceneId, kind, durationSec?)`, `setLook(scope, name, intensity)`, `setTextEffect(layerId, name)`. Unknown names fail with an error that lists the valid ones, which the loop already feeds back to the model.
3. **A curated catalog block** (about 15 presets with a "use for" line) added to the builder's system text and to the showrunner's rule 3 behind `MOTION_KIT`.
4. **Style bible fields**: `motion` (snappy, smooth or calm), `look` (name and intensity) and `transition` (one kind per film). Every parallel builder gets them, so scenes built at the same time match.
5. **Continuity rules** (deterministic, because the critic sees stills): every scene has an entrance on its headline, at most three distinct presets per film, transitions use the bible's kind, no look above the bible's intensity.
6. **Camera**: the energetic presets from M6 become the default for hero scenes; "calm" stays available.

## C. How we test it once an alpha is out

Install the alpha, bump `ralph/ENGINE_SPEC`, then run in this order. Steps 1 to 3 cost nothing.

1. **Engine contract** (offline, headless Chrome, `/clip-check.html`-style pages): for each M-row above, one page and one assertion from the Acceptance column. Record the results in a table in this file.
2. **Director offline tests** (fakes, no Meta calls):
   - every tool rejects an unknown name and lists the valid ones;
   - the prompt block contains only names that exist in the catalog;
   - with `MOTION_KIT` off, the showrunner system prompt, the builder prompt and the tool list are unchanged;
   - a composition built through the new tools passes `lightValidate` and the engine schema;
   - each new continuity rule has one passing and one failing film.
3. **Capture check**: a three-scene film with a transition, a look and a text effect, captured at the start, middle and end of each scene. Frames in a scene must differ by more than a set threshold (motion is visible), and no frame is blank. Save the frames in `debug/` (not temp folders).
4. **Live run** (paid, about $0.50, needs approval): `npm run live -- s13-3d --yes` with `MOTION_KIT=true` on the can brief, then the same on the crew run. Pass if all of these hold:
   - every scene has an entrance, and at least one transition and one look appear in the composition;
   - the film reaches `ready` with no failed job caused by a tool refusing a name;
   - the continuity rules report no errors;
   - cost stays inside the film budget and each rerun is within 25 % of the run without the kit.
5. **Human score**, 1 to 5 on "feels alive, not static", on the exported MP4. Keep the kit in the demo at 4 or above; otherwise leave it off and say so in the notes.

## D. Open questions

- Which AEP layer fields carry `animationIn` / `animationOut` (M2): the existing `transformation` ones, or new ones in the 1.9 schema?
- Which transitions can the engine do without a shader pass per frame (M3, M8)?
- Does the in-browser MP4 export (mediabunny) pick up `postFx` and VFX filters (M7)?
- Where does the `motionCatalog` live: the main entry, or a separate `reacthub-pixitweenjs/catalog` entry so the server does not pull in Pixi?
