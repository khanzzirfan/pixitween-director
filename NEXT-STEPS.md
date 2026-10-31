# Next steps (owner)

Status on Thu 29 Oct 2026. The plan now centres on **the Muse crew**: a Muse Wonder showrunner leading parallel
Muse Spark workers while you keep directing it (step S12). Specs: `docs/hackathon/09-crew-swarm.md` and
`docs/hackathon/steps/step-12-crew-swarm/` (local only). Ralph PRDs: `ralph/prd-s12a…e`.

## Done
- [x] Meta billing, $150 credits; engine `reacthub-pixitweenjs@0.3.0-alpha.3` published; repo public.
- [x] Waves 1–4 built on `integration`: skeleton, authoring core, director, art + SAM layers, review rules and frame
      review, chat edit, Clippy client and generate mode, export + gallery, deploy config, Local mode, Spark Open.
- [x] Root causes of both engine bugs found (`reacthub-pixitweenjs/docs/director-uplift/01-texture-teardown-fixes.md`).
- [x] S12 crew specs, contracts (D-17 to D-23) and five Ralph PRDs (61 stories) written; `build_prds.py --check` OK.
- [x] S13 3D product shots: engine side shipped (`0.3.0-alpha.5`), contracts (D-24 to D-27) and two Ralph PRDs (25 stories).

## Today (Thu 29) — the critical path
1. [~] **Engine fix.** Published as `0.3.0-alpha.5` on 29 Oct (texture teardown fixes plus `model3d`). Still to do here: `npm i`, check a
       two-scene film plays across the boundary (`/clip-check.html?noclip=1`), then mark both `ENGINE-NEEDS.md` rows closed.
2. [ ] **Finish S08b.** Write the tests in `tests/index.md`, then commit the uncommitted `server/http/*` review fixes.
3. [ ] **Merge `integration` → `main`.** S12 worktrees branch from `main`.
4. [ ] **Start S12a** in a worktree (`ralph/s12a-crew-core`). Its US-001 is the Wonder probe script.
5. [ ] **MG-1 Wonder probe:** `npm run live -- s12-wonder` (read the estimate, ≈ $0.30), then `--yes`.
       Pass = access 200, valid tool calls in ≥ 4 of 5 runs, parallel dispatch in ≥ 3 of 5. Record latency and cost per turn.
       Then set `SHOWRUNNER_MODEL` (`muse-wonder-1.0`, or `muse-spark-1.3-contributor` if it fails).

- [ ] **3D stage (aep-31):** engine build in progress (`reacthub-pixitweenjs`, branch `feat/aep-31-stage3d`). When it ships as `0.3.0-alpha.6`, follow `docs/stage3d.md` (update the S16b stories first, then the free checks, then `s16-cartoon`).

## Fri 30
- [ ] Merge S12a. Start **wave 7** in four worktrees: `s12b-showrunner`, `s12c-crew-workers`, `s12d-crew-ui`, `s13a-product-3d-core`.
- [ ] **Engine 3D:** the engine side is shipped in `0.3.0-alpha.5`; install it, bump `ralph/ENGINE_SPEC`, and run the S13 browser checks.
- [ ] Run the outstanding live gates of the built steps and record them: `s03-director`, `s04-art`, `s05-review`, `s06-chat`.
- [ ] Clippy Pro token → `CLIPPY_TOKEN`, `CLIPPY_MCP_URL` (needed for `s07-generate` on Sun).

## Sat 31 — M1
- [ ] Merge wave 7. **MG-2:** `npm run live -- s12-crew --yes` (≈ $1). M1 = a live crew film with 4 builders at once,
      one mid-build change by chat, one critic fix.

## Sun 1
- [ ] `s12e-crew-replay` and `s13b-product-3d-director`. `s07-generate` (one clip, 25 credits), `s09-local`.
- [ ] Set `PRODUCT_3D=true`. **S13 MG-1:** `npm run live -- s13-3d --yes` (≈ $0.40); keep 3D in the demo only if realism is 4/5 or better.
- [ ] **MG-3:** `npm run live -- s12-crew --ab --yes` (≈ $3) → paste the table into the PR and the orchestration review.

## Mon 2 — M2
- [ ] Deploy (`deploy/README.md`) with `CREW_ENABLED=true`, `FILMS_STARTS_PER_WINDOW=2`, `CREW_FILM_BUDGET_USD=1.5`; smoke it logged out.
- [ ] **MG-4:** the demo script in the browser twice in a row. Feature the best run in the gallery (its replay is what judges see first).
- [ ] `s10-docs-submission` runs after the crew is in, so the README leads with the crew and quotes `scripts/crew-report.ts` numbers.

## Tue 3 — M3 freeze 23:59 ET · Wed 4 — M4 submit by 12:00 ET (hard 21:00 ET)
- [ ] Record the demo, `npx tsx scripts/preflight-submission.ts --strict`, submit, post the 30 s crew clip on X.

Cut order if time runs short: S11 MCP server → takes → 3D extruded cut-outs (then 3D itself if MG-1 < 4) → Local mode → voice → export → Wonder (fall back to a Spark showrunner).
Never cut: the engine fix, the crew core, chat while building, builders + critic, crew board + live storyboard, Image + SAM layers, one generate clip, the featured replay.
