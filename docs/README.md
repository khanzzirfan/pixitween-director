# Docs index

PixiTween Director makes photoreal 9:16 product ads, and a Catalog Crew that turns a CSV feed into one retail clip per product. The engine is `reacthub-pixitweenjs` (0.3.5 as of 31 Oct 2026). Deadline for the hackathon submission: Wed 4 Nov 2026, 21:00 EST.

## Where to start

| If you want | Read |
|-------------|------|
| What is done and what to do next | [learn-improvement-progress/](learn-improvement-progress/README.md) (dated log) and [next steps](learn-improvement-progress/2026-10-31-next-steps.md) |
| The 3D hero clip, how it is built and run | [the 3D hero entry](learn-improvement-progress/2026-10-31-3d-hero-clip.md) |
| How the crew of agents makes a film | [crew.md](crew.md) |
| How the pieces fit | [architecture.md](architecture.md) and [architecture/README.md](architecture/README.md) |
| What is new and what existed before the event | [new-vs-existing.md](new-vs-existing.md) |

## How it works

| Doc | What it covers |
|-----|----------------|
| [architecture.md](architecture.md) | UI, API contract, backend, outside services, the film lifecycle and the tool list |
| [architecture/README.md](architecture/README.md) | The architecture in a nutshell, as of 29 Oct |
| [crew.md](crew.md) | Showrunner, parallel scene builders, critic, jobs, budget, replay |
| [local-mode.md](local-mode.md) | Running on open-weight models for privacy, offline or free use |
| [baseten-spark-open.md](baseten-spark-open.md) | Muse Spark Open on Baseten |
| [motion-kit.md](motion-kit.md) | Animation, transitions and looks for the crew |

## Product shots and 3D

| Doc | What it covers |
|-----|----------------|
| [3D hero clip](learn-improvement-progress/2026-10-31-3d-hero-clip.md) | **The 3D hero clip:** tumble, turn, light sweep, real dolly zoom; catalogue wiring; engine changes; limits |
| [3d.md](3d.md) | The real product wrapped on a 3D shape; the Motion, 3D or Generate choice; unwrapping a label from a photo |
| [stage3d.md](stage3d.md) | The 3D stage: characters and the product in one lit scene |

## Direction (how an ad should look)

[direction/README.md](direction/README.md) and its corpus:

| Doc | What it covers |
|-----|----------------|
| [01 Ad laws](direction/corpus/01-ad-laws.md) | The rules every clip follows |
| [02 Looks](direction/corpus/02-looks.md) | The look recipes (tabletop hero, flat lay, pedestal, lifestyle, ingredient orbit, price promo) |
| [03 Plate prompts](direction/corpus/03-plate-prompts.md) | How background plates are prompted |
| [04 Motion and edit](direction/corpus/04-motion-and-edit.md) | Timings and edits |
| [05 Critic rubric](direction/corpus/05-critic-rubric.md) | What the blind critic checks |
| [06 Reference films](direction/corpus/06-reference-films.md) | Lessons from eight collected product ads, and the build list (R1 to R8) |

The `hero-3d` look has no recipe in `02-looks.md`: it is a separate builder (see [the 3D hero entry](learn-improvement-progress/2026-10-31-3d-hero-clip.md)).

## Engine reference

[engine/README.md](engine/README.md) is the engine reference for the agents that write compositions.

## Progress log

[learn-improvement-progress/](learn-improvement-progress/README.md) is the dated record of what was done, what was learned and what is next. Newest entries first; its index links every entry.

## Todos

| Doc | What it covers |
|-----|----------------|
| [learn-improvement-progress/](learn-improvement-progress/README.md) | **Dated progress log**: what was built and learned, and the priority list to the deadline |
| [todos/KNOWN-GAPS.md](todos/KNOWN-GAPS.md) | Known defects and gaps, with the 3D hero section |
| [todos/CATALOG-CREW.md](todos/CATALOG-CREW.md) | The retail clip and the catalogue stories C1 to C12 |
| [todos/DEMO-POLISH.md](todos/DEMO-POLISH.md) | Look quality and defects seen in live runs |
| [todos/SUBMISSION.md](todos/SUBMISSION.md) | The 3-minute demo script, deploy, rehearsal, submit |
| [todos/ENGINE-NEEDS.md](todos/ENGINE-NEEDS.md) | What the engine still needs |
| [todos/ASSET-CREDITS.md](todos/ASSET-CREDITS.md) | Credits for models and assets used |
| [PLANNER.md](PLANNER.md) | The master plan for the submission |

## Planning notes (local)

The build plans, step designs and the Ralph PRD index live in `docs/hackathon/`, which is not published. Its entry point is `docs/hackathon/INDEX.md`.
