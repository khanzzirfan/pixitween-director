# Learn and improvement: progress log

A dated record of what was built, what was learned and what comes next, newest first. Each entry stands alone; start with the next-steps entry if you only have a minute.

Deadline for the hackathon submission: **Wed 4 Nov 2026, 21:00 EST.**

## Entries

| Date | Entry | What it covers |
|------|-------|----------------|
| 31 Oct 2026 | [Next steps](2026-10-31-next-steps.md) | **Priority list to the deadline**: submission documents first, then demo path, catalogue crew, 3D hero improvements |
| 31 Oct 2026 | [The 3D hero clip](2026-10-31-3d-hero-clip.md) | Tumble, turn, light sweep, real dolly zoom, price disc; how it is built, run and limited |
| 31 Oct 2026 | [Engine changes (0.3.5)](2026-10-31-engine-fov-and-shadow.md) | Animatable camera fov, soft shadow edge, and the release mistake (0.3.4 shipped without the fixes) |
| 31 Oct 2026 | [The 3D hero in the catalogue](2026-10-31-catalogue-hero-3d.md) | `pickLook`, `prepareRound`, `buildCatalogClip`, the live run on the sample feed |
| 31 Oct 2026 | [Player and viewer fixes](2026-10-31-player-and-viewer-fixes.md) | Play button stuck on Pause, compact check page, viewer setup |

## Where we are (31 Oct 2026)

- The 3D hero clip is built, tested, run live on the six-product sample feed and viewed in the browser. It needs `reacthub-pixitweenjs` 0.3.5.
- Tests: 10 failures, all from before this work: nine submission-document checks (the documents are not written yet) and one engine schema-version check.
- Not done: submission documents, deploy, rehearsal and recording, the catalogue wall and live price edit.

## Related docs

| Doc | What it covers |
|-----|----------------|
| [Docs index](../README.md) | All documentation |
| [3d.md](../3d.md) | The real product on a 3D shape, and the label unwrap |
| [crew.md](../crew.md) | The crew of agents |
| [KNOWN-GAPS.md](../todos/KNOWN-GAPS.md) | Defects and gaps |
| [CATALOG-CREW.md](../todos/CATALOG-CREW.md) | Catalogue stories C1 to C12 |
| [SUBMISSION.md](../todos/SUBMISSION.md) | The 3-minute demo script and submission steps |
| [Reference films](../direction/corpus/06-reference-films.md) | The ads we studied, and the build list R1 to R8 |

## How to add an entry

Create `YYYY-MM-DD-short-name.md`, start it with `# <date>: <title>`, end it with a link back to this index, and add a row above (newest first).
