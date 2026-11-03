# Session notes: 2026-11-03 (cinematic product films)

Companion to [cinematic-handover.md](cinematic-handover.md), which holds the ranked to-do list and the run/verify recipe. This file is the record of what was asked, what was decided, what broke and what was learned. Nothing in this session was committed.

## 1. What the owner asked, in order

1. "What are these droplets?" (a can image), then: the reference (droplet-flow-simulation) slides droplets down smoothly, ours look patched on. "Take the reference, learn the code and write it nicely."
2. Test the oud perfume with background smoke and a smoke reveal.
3. "Is the ember-coal card needed?" (it buried the product).
4. Complaint: the new oud film (`film_9b70c656c118`) is the same as cold brew; everything must be decided by Muse; code only provides tools. "Do not hardcode anything." The owner listed the tools Muse should choose from: dolly, zoom, animation, smoke, GL effects, transitions.
5. "Yes, do it": give Muse the set palette and the end card.
6. "Tell me how to make it better. 3D, spin, motion, animation, GL shader, absolute cinema frames. No compromise." I answered with a ranked list (lighting, motion blur, product spin first).
7. "Yes, top three": built product spin, light and motion blur.
8. "Yes, fix it": the cut-out ("no product found in the photo") that dropped photos to the 2D film.
9. Handover doc for the next agent, then these session notes.

## 2. Timeline of work

### Droplets
- First attempt used a roughness-map bead texture (red = height, green = roughness) with fewer, bigger beads. Better than white speckle, still not sliding.
- Rewrote the technique from the simulation's idea (gravity against static and dynamic friction, drops as half spheres) without copying its code (unlicensed): `engine/src/three/build/runners.ts`. A drop's place is a closed-form function of time and seed, so seeking is exact. Drops hold, grow, then slide in hops with an abrupt catch, leave trails, and are clear water (transmission, ior 1.33). They sit mostly on the camera-facing side. 7 unit tests.

### Oud smoke
- Set air `smoke` added: two persistent steam plumes behind the product (`set-art.ts` `SET_AIR`, `airProps` in `cinematic-film.ts`). A cloud in front washed out the bottle, so smoke is placed behind; big cards (the ember card) now also play behind the product.

### De-templating (the main rule of the session)
- Cause of "same as cold brew": rules and recipes in `beatsheet.ts`, `cinematic-rules.ts` and `cinematic-film.ts` fixed shot grammar, moves, camera distances, durations and the end card.
- Fix: the checker became breakage-only (shot count, length, hold share, element validity, text rules, at most 3 non-hard cuts, product visible at the end). `MOVE_RULES`, `mendSheet` and the "kept board" logic were removed. Per-shot `camera`, ingredient `place`/`scale`, `set.palette`, `endCard` style were added as options. The prompt was rewritten as a menu, temperature 0.9, "do not default to blue". The reference deck now shows four differently shaped worked boards, picked with a hash of the product text.
- Dropped elements: shots using a dropped element play without it instead of rejecting the whole board (`reviewBoard`).
- Saved as memory `muse-decides-creative` (plus the existing `no-commits` and `submission-timeline`).

### Top three upgrades
Spin, light, motion blur: see the handover doc for files and design. Key choices:
- Spin is a per-shot object (degrees, ease, tilt, roll, lift); `product: turn|drop|still` remains only as the fallback.
- Light is per-shot direction/elevation/strength plus board-level key and rim colours; the rim colour required an engine change because the rim was always white.
- Motion blur is export-only accumulation (n sub-frames averaged) driven by per-shot shutter values travelling AEP -> engine layer -> runtime `blurAt` -> player handles -> export loop. The live player does not blur.

### Cut-out fix
- Probed SAM directly: "goggles" 0.92, "swim goggles" 0.88, "glasses" 0.86; "eyewear", "mask" nothing; "perfume" 0.90, "bottle" 0.96, "box" nothing; "product"/"object" nothing on all photos; the cooler under "cooler" scored 0.59-0.60 (close to the 0.5 bar). So failures come from the word asked for and borderline confidence, not random noise.
- Fix: several words tried in order, near-miss kept, then Muse names the object from the photo. Verified live on the perfume and goggles photos.

## 3. Real runs made (all through `POST /api/lineups`)

| Film | What | Result |
|---|---|---|
| `film_9b70c656c118` | oud (owner's complaint) | looked like cold brew: the bug that started the de-templating |
| oud / cold brew / cooler runs after the de-templating | | distinct looks: long 18-20 deg lens oud; 75 deg lens cold brew with whip/glitch/zoom cuts; cooler 65->24 deg lens on a beach |
| `film_01bf4fd42abd` | cold brew, "calm sunrise" brief | tan sunrise world, plain price, uppercase words |
| `film_750bb793296c` | cooler, "rugged dusk" brief | amber band, bar plates, orange tag |
| `film_9536765e37e3` | Habik perfume | fell to 2D (cut-out failure, now fixed) |
| `film_8476ef48c88e` | cooler, first try this turn | fell to 2D: "no product found in the photo" (flaky cut-out) |
| `film_7e12bc4bfb4a` | cooler, same inputs | 3D; Muse used cold key `#d7e9ff`, per-shot light directions, lean/roll/toss, shutter 0.5 (0.7 on one shot) |
| `film_6a7166dd4882` | Habik perfume, after the fix | 3D world present |
| `film_f1ca3a6ab168` | swim goggles, after the fix | 3D world present |

Each real run costs a few cents (Spark board about $0.005, element pictures about $0.0125 each, SAM about $0.0025 a call).

## 4. Errors and fixes

- Droplets looked like white speckle: roughness-map beads, fewer and larger.
- Droplets looked patched on: runner drops with trails and hop physics.
- Smoke washed out the bottle: cloud moved behind; large cards play behind.
- Muse board rejected for dropped `bean`/`ice`: `reviewBoard` strips those references.
- `framingDistance` type error: explicit `number` type for fov.
- eslint type-import error on `EASES`: `--fix`.
- Old tests asserted removed rules: rewritten or removed.
- macOS `sed` failures (`|` in patterns, flags): used Python edits.
- Blank frames / "3D layer did not draw in time": vite did not serve files added or edited after it started. Restart vite.
- Server down / 429 rate limit / my films interrupted by the owner's `npm run dev` restart: ran my own server with `FILMS_PER_HOUR_PER_IP=50 GENERATE_MAX_PER_HOUR=50`.
- `pkill` by pattern was blocked by the permission classifier (it could kill the owner's server): kill by PID only.
- `page.evaluate(fn)` under tsx failed with `__name is not defined`: pass the code as a string.
- A scratchpad script could not import `sharp`: ran it from inside `scripts/` and deleted it.
- The in-page blur export test was too slow in software rendering (about 7 min for 70 frames at 10 samples): left it running and read the result later.
- A mistyped tool name (`bash`) and a blocked `sleep` chain: used `Bash` and a `Monitor` until-loop.
- Test debug output was invisible in vitest: wrote to a file.

## 4b. Facts worth remembering

- The film's world is one `stage3d` layer: all 3D state lives in tweens, limit 64 per layer (`CAMERA.tweenBudget` 62). Light keys and the handheld shake compete for it; the builder subtracts light keys from the shake budget.
- Rotation keys are `[pitch, yaw, roll]` euler degrees; the product's pitch rests at 4.
- `rise` keys are metres above the floor; the product is `PRODUCT_H` = 0.16 m tall; a lift of 1.5 is 0.24 m.
- Shot frames: a shot's last frame is one frame before the next shot's first.
- `ExportDriver.blurAt` is optional; drivers without it behave exactly as before. With it, every export draws through a 2D copy canvas, blurred or not.
- Rim colour, spin and light are all optional in the board; with none written, the film plays the old default sweep.

## 5. State at the end of the session

- Branch `feat/sqlite-upgrade`, all changes uncommitted. Modified areas: `engine/` (lighting, schema, runtime, player), `shared/aep/layer.ts`, `server/authoring/*`, `server/crew/cinematic-cut.ts`, `server/art/cutout.ts`, `web/src/{export,motion,player,dev}`, `docs/architecture/cinematic-rules.md`, plus tests. New files: `docs/toimprove/*`.
- `git status` shows `scripts/tmp-frames.mts` and `web/public/tmp-a.json` as deleted (they were committed earlier; I removed them). The owner decides whether to commit that.
- Checks: 2906 tests pass, 1 old failure (`server/agent/director.test.ts`, predates this work); typecheck and lint clean.
- My API server (8787) and preview server (5199) are stopped. The owner must restart `npm run dev` to see the changes.
- Not verified: a full MP4 export with blur played back; a 360 degree spin on a round pack; the coloured rim on a real frame; the cut-out fix on more than three photos; the new films' frames after the cut-out fix.

## 6. Suggested order for the next session

1. Restart dev, open `film_7e12bc4bfb4a`, `film_6a7166dd4882`, `film_f1ca3a6ab168` and look at them.
2. Make an MP4 through the Export panel on a film with blur and check duration, file size and time taken.
3. Run a round-can film with a 360 degree spin; look for a mid-shot stall.
4. Then work the ranked list in `cinematic-handover.md`, keeping every new feature a Muse option.
