# Engine patch for reacthub-pixitweenjs (0.3.0-alpha.3 -> next)

Both open rows in `ENGINE-NEEDS.md` come from texture teardown. Line numbers are for
`dist/index.es.js` in 0.3.0-alpha.3, so search for the function names too. This is a diagnosis
from reading the bundle. It has not been run against a patched build.

## Fix 1: image sprite destroys a texture that `Assets` still caches (multi-scene crash)

`loadSpriteTexture` (minified `ez`, line 2283) returns a `dispose` callback:

```js
dispose: () => {
  if (!isHttp && texture) {          // isHttp = src starts with http:// or https://
    try { texture.destroy(true); texture = null; } catch {}
  }
}
```

The image sprite effect (line 3824) calls it on every unmount or `src` change. The guard skips
destroy only for http(s) URLs. This app serves assets from `/api/assets/<id>`, a relative URL, so
the sprite destroys a texture that `Assets.load` still holds in its cache.

The next `Assets.load` of the same URL returns that dead texture. Its `source` is null, and Pixi
throws `Cannot read properties of null (reading 'alphaMode')` in `getAdjustedBlendModeBlend`. It
also logs `A TextureSource managed by Assets was destroyed instead of unloaded`, the 94 warnings
in the first row.

This fits the recorded symptoms:
- One scene never unmounts its sprites, so it is fine.
- Two scenes with no images have no sprites to destroy.
- An image in scene 1 only, or scene 2 only, fails because the scene precomp remounts at the boundary.
- A distinct `src` per scene does not help, because the destroy happens either way.

Change: a texture that came from `Assets.load` is released with `Assets.unload`, never `destroy`,
whatever the URL looks like.

```js
dispose: () => {
  if (!texture) return;
  try { Assets.unload(url); } catch {}   // drops it from the cache and destroys the source once
  texture = null;
}
```

`Assets.unload` returns a promise. Do not await it in the cleanup.

## Fix 2: video sprite destroys the same source twice (a video layer blanks the film)

The video sprite cleanup (line 44167) ends with `Ut?.destroy(!0), we?.destroy()`.
`Ut` is the `Texture` and `we` is the `VideoSource` it wraps. `Ut.destroy(true)` already destroys
the source, so `we.destroy()` runs on a source whose `resource` is null.
`VideoSource.destroy -> _configureAutoUpdate -> _isSourcePlaying` then reads `.paused` on null.
That is the `reading 'paused'` error in the second row. React aborts the unmount and the canvas blanks.

Change: remove the second call.

```js
Ut?.destroy(true);   // was: Ut?.destroy(true), we?.destroy()
```

If the source can exist without the texture (setup `D()` fails between the two constructors),
use `if (Ut) Ut.destroy(true); else we?.destroy();`.

## Not the cause

The RenderTexture pool (`p$`, `m$`, `g$`, line 48070 onward) only destroys textures that are not
in use. Leave it. The GIF sprite (line 44562) and the overlay (line 647) call `Assets.load` and
never destroy.

## Verify after publishing

1. `npm i reacthub-pixitweenjs@<new>`, then `npm run dev`.
2. Open `/clip-check.html?noclip=1` and play through the scene 1 -> scene 2 boundary. It should
   keep drawing, with no `alphaMode` error and no `Assets` warnings in the console.
3. Open `/clip-check.html`. Seek to scene 2 + 0.5 s. The headline and the clip frame should be
   visible, with no `paused` error.
4. Then in this repo: close the two `ENGINE-NEEDS.md` rows, run the browser checks for S05b US-013
   and US-016, and the MG-2 and MG-3 manual gates.

## Trying it here first (optional)

`patch-package` can apply both edits to `node_modules` so the result shows before you publish. Edit
`node_modules/reacthub-pixitweenjs/dist/index.es.js` at the two places, run
`npx patch-package reacthub-pixitweenjs`, and add `"postinstall": "patch-package"` to
`package.json`. Delete the patch when the published version carries the fix.
