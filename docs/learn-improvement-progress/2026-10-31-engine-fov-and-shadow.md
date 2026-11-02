# 31 Oct 2026: engine changes for the 3D hero (reacthub-pixitweenjs 0.3.5)

Question that started it: the first dolly zoom looked mild. Was that our 3D code or the engine? Answer: the engine. A 3D layer's camera is framed once from its lens angle (`frameCamera`, using `fitDistance`), and the director could only fake a zoom by scaling or moving the layer, which changed the can's size. The fix belongs in the engine.

## What changed

| Change | Files (engine repo) | Effect |
|--------|---------------------|--------|
| **Animatable `camera.fov`** | `src/types/aep/layer.ts`, `src/components/AepComposition/model3d/sampleModel3D.ts` | A `model3d` layer's lens angle takes keyframes (10 to 90 degrees). The camera re-frames the model at every fov, so the model holds its size on screen while the perspective changes: a true dolly zoom |
| **Soft shadow edge** | `model3d/framing.ts` (`shadowEdgeFade`), `model3d/shadowFade.ts`, `Pixi3DModelLayer.tsx` | The shadow plane fades radially to nothing at its edge. Before, it ended in a hard-edged dark slab beside the product |

Tests added in the engine: animated, static and default fov; a size-held check; schema accepts animated fov and rejects fov 5; the fade curve and the shader patch. Full engine suite: 1258 pass, 2 expected failures. The engine docs page for model3d documents the animatable camera.

## Director side

- `server/product3d/types.ts`: the mirror schema accepts animated fov.
- `web/src/authoring-agreement.test.tsx`: builds a sale hero clip and checks it with the real `parseAepCompositionSafe` and the light validator. On an engine without the fix it fails with `camera.fov: Expected number, received array`.
- The server's light validator does not check engine schema details, so that test is the guard.

## Release story (what went wrong, so it does not repeat)

| Version | State |
|---------|-------|
| 0.3.3 | On npm already while the engine repo's `package.json` still said 0.3.2, so the patch release script would have tried 0.3.3 again |
| 0.3.4 | Published, but **without the fixes**: the release script runs `standard-version` then `npm publish` with no build step, so it published an older `dist` from disk. Found by downloading the tarball and searching for `vShadowPos` |
| 0.3.5 | Rebuilt and published; the tarball has both fixes. The director depends on `^0.3.5` |

Lessons:
1. Check a release by downloading the tarball (`npm pack reacthub-pixitweenjs@<version>`) and searching `dist` for the change.
2. Add `"prepublishOnly": "npm run build"` to the engine's `package.json` (not done yet).
3. After an engine bump, restart dev servers with `--force`: Vite keeps the old engine in memory and in `node_modules/.vite`, and shows `engine schema: errors ... camera.fov`.
4. `npm install` replaces any hand-copied engine build with the registry copy.

Index: [README.md](README.md).
