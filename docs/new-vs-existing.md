# New vs existing

What was built during the Meta Global AI Developer Hackathon (27 Oct – 4 Nov 2026), and what already existed.

## Built during the hackathon

The repository history starts on 28 Oct 2026, the second day of the event; `git log` shows every commit after it. No code was copied from another project. The player engine is our own Three.js engine in `engine/`, written during the event. The composition format it plays is the AEP schema, version 1.12.0 (`shared/aep/`).

| Folder | What it holds | Built in |
|--------|---------------|----------|
| `server/` | the Hono API; the film store and event log; the Meta, Clippy, Glimmer and Baseten clients; the authoring core, art, review, edit and generate tools; the director; the crew (showrunner, job board, builders, critic, continuity, takes); the 3D product tools | steps S2 to S9, S12, S13 |
| `web/` | the React studio and its shell; the player; frame capture and MP4 export; the gallery; the crew board, map, chat and replay; the 3D check page | steps S2 to S9, S12, S13, S14 |
| `engine/` | the Motion engine: our own GSAP and Three.js player for a single composition JSON document, with its CLI, effects, camera and post-processing | the Three.js migration (PRDs `r1` to `r7`, `a2` to `a5`, `m1` to `m8`) |
| `shared/` | the contracts used by both sides: film state, storyboard, events, crew, tools and ports, and the AEP composition schema (version 1.12.0) | S2, S12 |
| `scripts/` | the live-check runner and the live checks, the cost-per-film calculator, the crew report, the demo-film loader, the submission preflight | S2 to S13 |
| `deploy/` | the container, the Fly.io configuration and the pre-deploy check | S8b |
| `e2e/` | the Playwright flows, using the fake director and the fake crew | S2, S12 |
| `fixtures/` | recorded real-shape responses from the day-one probes, hand-made compositions and the offline demo film | S1 to S13 |
| `docs/` | how the crew and the 3D product shots work, local mode, the architecture, and the submission documents | S9 to S13 |
| `ralph/` | the PRDs the build followed, one per step | S1 to S14 |
| `motion/` | a small version module and probe file for the Motion engine | the Three.js migration |
| `tasks/` | a draft PRD from the planning step | S10 |
| `tests/` | the index of tests by area | S8b |
| `.github/` | the continuous-integration workflow | the submission build |
| `.claude/` | the dev-server launch configuration for the preview tools | the catalog work |
| `test-results/` | the Playwright last-run marker | S2 |

## Pre-existing

| Dependency | Version | What it is | How we use it |
|------------|---------|-----------|---------------|
| `reacthub-pixitweenjs` | 0.3.2 | our earlier PixiJS and GSAP timeline engine, published on npm before the hackathon, under its own source-available licence | the starting point of the player. Never copied or edited here; the player now runs on the Three.js engine in `engine/` |
| Clippy video-generation service | remote service | a pre-existing video generator | only for approved *generate* scenes |
| Meta models | through the Meta Model API | Muse Wonder, Muse Spark, Muse Image, SAM 3.1, Muse Voice Transcribe, Muse Glimmer | see the README |
| `@meta-sam/parser` | 0.1.0 | Meta's parser for SAM output, under the SAM License | reading SAM results |
| Libraries | see `package.json` | React, PixiJS, Hono, Three.js, sharp, zod and others | as dependencies |

Early in the event, fixes to the older engine were published from its own repository as `0.3.0-alpha.4` and `0.3.0-alpha.5` (texture fixes and the `model3d` layer). That is engine work outside this repository; the Three.js engine in `engine/` replaced it as the player.

## Build process

The repository was written with AI coding agents (Ralph TUI with a local model, and Claude Code) from PRDs kept in `ralph/`, each a list of small stories with acceptance criteria that tests check offline. Money-spending checks are separate scripts that print an estimate and run only when the owner passes `--yes`. The first wave was 14 PRDs:

| PRD | Branch |
|-----|--------|
| `prd-s02-skeleton` | `ralph/s02-skeleton` |
| `prd-s03a-authoring-core` | `ralph/s03a-authoring-core` |
| `prd-s03b-director-agent` | `ralph/s03b-director-agent` |
| `prd-s04-art-layers` | `ralph/s04-art-layers` |
| `prd-s05a-review-rules` | `ralph/s05a-review-rules` |
| `prd-s05b-review-visual` | `ralph/s05b-review-visual` |
| `prd-s06-chat-edit` | `ralph/s06-chat-edit` |
| `prd-s07a-clippy-client` | `ralph/s07a-clippy-client` |
| `prd-s07b-generate-integration` | `ralph/s07b-generate-integration` |
| `prd-s08a-export-gallery` | `ralph/s08a-export-gallery` |
| `prd-s08b-deploy` | `ralph/s08b-deploy` |
| `prd-s09-local-mode` | `ralph/s09-local-mode` |
| `prd-s10-docs-submission` | `ralph/s10-docs` |
| `prd-s11-mcp-server` | `ralph/s11-mcp-server` (not built: an optional stretch the owner postponed) |

Ten more followed: the crew (`prd-s12a-crew-core`, `prd-s12b-showrunner`, `prd-s12c-crew-workers`, `prd-s12d-crew-ui`, `prd-s12e-crew-replay`, `prd-s12f-crew-finish`), the 3D product shots (`prd-s13a-product-3d-core`, `prd-s13b-product-3d-director`) and the studio shell (`prd-s14-studio-shell`). Most of the PRDs' own `passes` flags were not kept up to date while the work was done directly with Claude Code, so the preflight lists those PRDs as unfinished until the owner reviews them.

The live checks are `npm run live -- <name>`. These exist: `s02-smoke`, `s03-director`, `s05-review`, `s07-connect`, `s07-generate`, `s09-local`, `s12-wonder`, `s12-crew`, `s13-3d`, `baseten-smoke`. These planned ones were not written: `s04-art`, `s06-chat`, `s11-mcp`. Their areas are covered by the offline tests instead.

## How to verify

```bash
git log --reverse --format='%ad %s' --date=short | head -3   # the first commit is 2026-10-28
git log --reverse --format='%ad' --date=short -- engine | head -1   # the engine in engine/ was written during the event
git log --stat -- server | tail                              # the server was written commit by commit
npx tsx scripts/preflight-submission.ts                      # the submission checks
```
