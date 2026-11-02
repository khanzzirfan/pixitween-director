# 31 Oct 2026: next steps

Deadline: **Wed 4 Nov 2026, 21:00 EST** (aim for noon ET). Code freeze Mon 2 Nov 23:59 ET. Order below is by risk to the submission, not by interest.

## 1. Submission documents (blocks the submission)

Nine preflight checks in `scripts/preflight/docs.test.ts` fail today because the documents they read are not written yet.

- [ ] `docs/demo-script.md`: a Narration section of 250 to 380 words, a Shot list of at least 12 rows with valid times, and its labels and headings
- [ ] `docs/submission-answers.md`: a 180 to 230 word project description, short bonus claims, and a Claim evidence table where every path is a real file
- [ ] `docs/x-post.md`: at most 280 characters, owner markers counted as 23, no `@`
- [ ] `docs/s1-evidence.md`: every seed fixture and all eight live gates, and a note that the probe scripts are not copied
- [ ] `docs/new-vs-existing.md`: five headings, when the history starts, and the engine version from the lockfile (now 0.3.5)
- [ ] The tenth failing test, "uses the engine schema version" in `web/src/authoring-agreement.test.tsx`, expects 1.11.0 and gets 1.9.0: check which side is stale (the engine reports 1.9.0)

## 2. Demo path (the 3-minute script is in [SUBMISSION.md](../todos/SUBMISSION.md))

- [ ] Deploy with the crew on (`CREW=true`, keys set); the owner deploys
- [ ] Run the script twice in a row in the browser with no manual steps; keep a recorded fallback
- [ ] Catalogue wall: one live player over six posters, status chips (story C5 in [CATALOG-CREW.md](../todos/CATALOG-CREW.md))
- [ ] Live price edit: tiles update in about 2 s at $0 (C7)
- [ ] Put the 3D hero in the demo: Cold Brew's clip is the strongest shot we have

## 3. Catalogue crew (if time remains; cut order is in [CATALOG-CREW.md](../todos/CATALOG-CREW.md))

- [ ] Commit the catalogue store and `POST /api/catalogs` (C1)
- [ ] Showrunner `planCatalog` and `dispatchVariants` (C4)
- [ ] Wire the critic rubric into the catalogue run
- [ ] Price check: a rule on text boxes plus a Spark read of the price (C6)

## 4. Improvements to the 3D hero (all optional, after the above)

- [ ] **Label back panel:** the label covers only about 70 degrees either side of the front. Options: mirror the front arc, generate a back panel, or ask for a second photo
- [ ] **Splash:** a crown of 20 to 40 `prop3d` droplets on ballistic keys, or a particle emitter in the engine (about a day of engine work)
- [ ] **Ingredient props:** GLB ingredients orbiting in a `stage3d` (reference build R7)
- [ ] **More shapes:** bottles with shoulders, boxes and pouches in the 3D look; mugs stay 2D until a handle can be modelled
- [ ] **Accent:** dark products give a dark clip (the sample can is `#402f27`); lift the field and halo when the accent is very dark
- [ ] **Release hygiene:** the engine's `release` script publishes whatever `dist` is on disk, so 0.3.4 shipped without the fixes. Add `"prepublishOnly": "npm run build"` to the engine's `package.json`

## Done recently

| Date | What |
|------|------|
| 31 Oct | 3D hero clip: tumble, turn, light sweep, dolly zoom, price disc ([entry](2026-10-31-3d-hero-clip.md)) |
| 31 Oct | Engine 0.3.5: animated `camera.fov` and a soft shadow edge |
| 31 Oct | `hero-3d` wired into `pickLook` and `s19-catalog`; live run on the sample feed (about $0.005) |
| 31 Oct | Player: play button returns to Play when a clip ends; compact stage-check page |
| 31 Oct | Catalogue findings fixed: accent from the photo, brand column, tagline from shared title words, mug plate |
