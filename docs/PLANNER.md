# Planner: photoreal product-ad demo (draft v1, 31 Oct 2026)

Master plan for the hackathon submission, due **Wed 4 Nov 2026, 21:00 EST** (target: submit by 12:00 ET).
`[x]` done and checked, `[~]` built but not fully verified, `[ ]` not started. Update the boxes when work lands.
Detail lives in `docs/todos/`: [DEMO-POLISH](todos/DEMO-POLISH.md), [CATALOG-CREW](todos/CATALOG-CREW.md),
[SUBMISSION](todos/SUBMISSION.md), [KNOWN-GAPS](todos/KNOWN-GAPS.md). Engine gaps stay in [ENGINE-NEEDS](todos/ENGINE-NEEDS.md).

## Decision (30 Oct)
The toy cartoon (stage3d, `CARTOON_MODE`) scored 3 of 5 and left the demo. The hero is a 9:16 photoreal product ad built by
the crew from one product photo, then fanned out to a catalog. Cartoon code stays, off by default.

## Progress

| # | Track | Status | Gate |
|---|---|---|---|
| 1 | Crew builds a film live (Wonder, Spark, board, critic, fix jobs) | [x] | S12/S14 shipped |
| 2 | Photoreal 9:16 look spike on the can photo | [x] | scored about 3.5 of 5 (gate 4) |
| 3 | Product-photo fixes: cut-out guard, no generate mode without a token, text safe-area snap | [x] | tests pass |
| 4 | Finish pass: shadow, grade, shot flash, ad type, music bed | [~] | ran in two live films and shows in the frames; audio not heard in the player |
| 5 | Re-run live spike with the finish pass, score again | [~] | two runs: 164 s / $0.27 (one stub shot), 583 s / $0.56 (no stub). Look about 3.5 to 4; price missing on the end card, hero headline overflows |
| 6 | Second product (mug, bottle or sneaker), score again | [ ] | 4 or more on two products |
| 7 | Product in the scene (Muse Image edit with the photo as reference) | [ ] | hero no longer reads as a sticker |
| 8 | Catalog Crew core: import, master, variants, wall | [ ] | 6 to 12 variants from one master |
| 9 | Price check on the wall (rule + vision) | [ ] | one wrong price flagged and fixed |
| 10 | Live price edit, $0, tiles update | [ ] | about 2 s end to end |
| 10b | Speed: film built in under 3 minutes (now 164 s to 583 s, fix loops decide) | [ ] | see DEMO-POLISH, "Speed" |
| 11 | One generated clip (pour) via Clippy | [ ] | needs `CLIPPY_TOKEN`; first to cut |
| 12 | Deploy with crew on, demo script runs twice in a row | [ ] | no manual steps |
| 13 | Record, README, submission form, X clip | [ ] | submitted |

## Schedule

| Day | Work | Done |
|---|---|---|
| Thu 29 / Fri 30 | Cartoon spike, pivot plan, look spike, fixes | [x] |
| Sat 31 | Finish pass built and wired. Catalog plan re-read, cheap version scoped | [~] |
| Sun 1 | Live re-run and score. Catalog core: C1 import, C2 slots, C3 variants, C5 wall | [ ] |
| Mon 2 | Price check, live price edit, second product, optional generated clip | [ ] |
| Tue 3 | Deploy, rehearse twice, record. Freeze 23:59 ET | [ ] |
| Wed 4 | README, form, X clip. Submit by 12:00 ET | [ ] |

## Cut order (first to go)
Generated clip, voice brief (type it), catalog beyond 6 products, price-edit animation (keep the number change),
on-screen critic fix. **Never cut:** the full-screen finished ad with music.

## Cost so far
Look spike, three runs: about $1.2 (estimate was $1). Cartoon runs: about $0.76 for the last film. Track new runs in
`debug/s17/` and `debug/s15/`.

## Risks
- Look stays under 4: the catalog multiplies it. Mitigation: item 7, better source photos.
- Wonder returns 503 often: Spark fallback exists; record from a good run.
- Fix jobs can loop past a script's timeout: raise `FILM_TIMEOUT_MS`, cap fixes per scene.
- Paid runs share `./data` with the dev server: run live scripts with their own `DATA_DIR`.
