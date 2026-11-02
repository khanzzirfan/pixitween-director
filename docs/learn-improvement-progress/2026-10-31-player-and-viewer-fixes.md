# 31 Oct 2026: player and viewer fixes

## Play button stuck on Pause

When a clip ended, the button stayed on Pause. The player kept its own play state, but at the end of a film the engine rewinds to the start and pauses itself, and the button never heard about it. A play started through the player handle also did not show.

Fix (`web/src/player/Player.tsx`): the button follows the engine's play state (`playStateRef`) every frame; it falls back to what the button last asked for when the engine does not report a state, and it pauses at the end if the time has reached the duration. When playback stops, the time readout shows where the engine is.

Test: `web/src/player/Player.test.tsx`, "turns back to Play when the engine stops at the end of the film" (play, engine stops, button reads Play; play started elsewhere reads Pause). In the browser, a 5 s clip switched from Pause to Play at 5.0 s. Replay after the end was not confirmed on screen.

## Compact check page

`stage-check.html` showed the stage at full size and pushed the controls off screen. The stage is now at most 60% of the window height, with smaller text and spacing (`web/src/dev/stage-check.tsx`).

## Viewer setup that bit us

- The viewer needs the API server (`npm run dev`, not only the web server): the can's label and every image load from `/api/assets/...`.
- A web server started before an engine upgrade must be restarted with `--force`; see [engine changes](2026-10-31-engine-fov-and-shadow.md).
- Seeking by script: set the range input's value with the native setter, then fire `input` and `change`.

## Known player quirks (still open, in [KNOWN-GAPS.md](../todos/KNOWN-GAPS.md))

- Layer rotation is read as radians although the schema says degrees; builders convert with `deg()`.
- Track mattes draw empty, and layer masks draw nothing inside a precomp.
- `directional-blur` is in the effect list but does nothing.

Index: [README.md](README.md).
