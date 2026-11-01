# Running the hackathon build with Ralph TUI

Ralph runs a coding agent one **story** at a time against a PRD file, marks the
story done when its acceptance criteria pass, and moves on. Each iteration is a
fresh agent with no memory, so everything an agent needs is in the story, the
spec docs it names, and the repo itself.

This folder turns every step spec into a Ralph PRD. You author stories in
`src/prd-*.json` (compact), and `build_prds.py` generates the `prd-*.json` that
Ralph reads, adding the same guardrails and quality gates to all of them.

## 1. One-time setup (owner)

| # | Do | Where it's explained |
|---|----|----------------------|
| 1 | Publish the engine alpha to npm (`--tag alpha`), or plan to use `ENGINE_SPEC=file:../reacthub-pixitweenjs` | [05-repo-decision.md](../05-repo-decision.md) §1 |
| 2 | Create the GitHub repo `pixitween-director` (public, Apache-2.0 licence only), clone it | 05 §2 |
| 3 | `ENGINE_SPEC=<spec> ./ralph/bootstrap-repo.sh <clone-path>` (no commit, no push) | `bootstrap-repo.sh` header |
| 4 | Make the first commit (dated 27 Oct 2026), push | |
| 5 | `python3 ralph/build_prds.py --check` (validates the PRDs; must print OK) | §5 |
| 6 | Install `ralph-tui` (`ralph-tui --version`; tested with 0.12.0) and pick the agent in `.ralph-tui/config.toml` | |

## 2. The PRDs and the order to run them

Stories inside a PRD run in order, honouring `dependsOn`. PRDs depend on each
other as shown: a PRD must not start until the ones it `requires` are
**merged to `main`**.

| Wave | PRD file | Spec | Branch | `requires` (merged to `main`) |
|------|----------|------|--------|-------------------------------|
| 1 | `prd-s02-skeleton.json` | [S2](../steps/step-02-director-app-skeleton/design.md) | `ralph/s02-skeleton` | engine published or linked |
| 2 | `prd-s03a-authoring-core.json` | [S3](../steps/step-03-brief-to-composition/design.md) | `ralph/s03a-authoring-core` | s02 |
| 2 | `prd-s07a-clippy-client.json` | [S7](../steps/step-07-generate-mode-mcp/design.md) | `ralph/s07a-clippy-client` | s02 |
| 2 | `prd-s08a-export-gallery.json` | [S8](../steps/step-08-export-and-deploy/design.md) | `ralph/s08a-export-gallery` | s02 |
| 3 | `prd-s03b-director-agent.json` | S3 | `ralph/s03b-director-agent` | s03a |
| 3 | `prd-s04-art-layers.json` | [S4](../steps/step-04-muse-image-sam-layers/design.md) | `ralph/s04-art-layers` | s03a |
| 3 | `prd-s05a-review-rules.json` | [S5](../steps/step-05-self-review-loop/design.md) | `ralph/s05a-review-rules` | s03a |
| 3 | `prd-s06-chat-edit.json` | [S6](../steps/step-06-chat-edit-tools/design.md) | `ralph/s06-chat-edit` | s03a |
| 4 | `prd-s05b-review-visual.json` | S5 | `ralph/s05b-review-visual` | s03b, s04, s05a |
| 4 | `prd-s07b-generate-integration.json` | S7 | `ralph/s07b-generate-integration` | s04, s07a |
| 4 | `prd-s08b-deploy.json` | S8 | `ralph/s08b-deploy` | s03b, s08a |
| 4 | `prd-s09-local-mode.json` | [S9](../steps/step-09-open-weight-lane/design.md) | `ralph/s09-local-mode` | s02, s06 |
| 4 | `prd-s11-mcp-server.json` | [S11](../steps/step-11-stretch/design.md) | `ralph/s11-mcp-server` | s03b, s06 |
| 6 | `prd-s12a-crew-core.json` | [S12](../steps/step-12-crew-swarm/design.md) | `ralph/s12a-crew-core` | the wave 1–4 PRDs, merged; engine fix published |
| 7 | `prd-s12b-showrunner.json` | S12 | `ralph/s12b-showrunner` | s12a |
| 7 | `prd-s12c-crew-workers.json` | S12 | `ralph/s12c-crew-workers` | s12a |
| 7 | `prd-s12d-crew-ui.json` | S12 | `ralph/s12d-crew-ui` | s12a |
| 7 | `prd-s13a-product-3d-core.json` | [S13](../steps/step-13-product-3d/design.md) | `ralph/s13a-product-3d-core` | the wave 1–4 PRDs, merged |
| 8 | `prd-s12e-crew-replay.json` | S12 | `ralph/s12e-crew-replay` | s12b, s12c, s12d |
| 8 | `prd-s13b-product-3d-director.json` | S13 | `ralph/s13b-product-3d-director` | s13a, s12b, s12d; engine `0.3.0-alpha.5` or newer for browser checks |
| 9 | `prd-s10-docs-submission.json` | [S10](../steps/step-10-demo-and-submission/design.md) | `ralph/s10-docs` | everything through wave 8 |

Steps whose second half needs other steps' output (S3, S5, S7, S8) are split
into an **a** and a **b** PRD, so every PRD can start the moment its `requires`
are merged. Ralph can only order stories inside one file, which is why the
split is by file.

S0 (accounts, repo creation, npm publish) and S1 (probes, done) are manual: no PRD.

## 3. Running one PRD (the loop)

One git worktree per concurrent Ralph run, so runs never share a working tree.

```bash
cd ~/Documents/code/trolio/pixitween-director          # the main checkout, on main, clean
git worktree add ../pixitween-s03 -b ralph/s03-director main
cd ../pixitween-s03 && npm ci
mkdir -p docs && ln -s ~/Documents/code/trolio/pixitween-director/docs/{hackathon,learn-improve,engine} docs/   # specs are gitignored, not in the worktree
ralph-tui run --prd ./ralph/prd-s03-director.json --iterations 0     # 0 = run until every story passes
```

- `--headless` (alias `--no-tui`) logs to stdout, for background runs.
- Ralph writes `passes: true` into the PRD file as stories finish; the working tree stays **uncommitted** (`autoCommit = false`).
- Interrupted? `ralph-tui run --prd … --resume`.
- A story that can't pass gets `notes` explaining why. Read them before the next run.

When all stories pass (or Ralph stops), **you** review, run the manual gates (§6), commit, merge to `main`, and remove the worktree:

```bash
git -C ../pixitween-s03 status && git -C ../pixitween-s03 diff --stat     # review
# commit on the branch, open a PR or merge locally, then:
git worktree remove ../pixitween-s03
```

Several PRDs of the same wave can run at once, each in its own worktree and its
own terminal. They own disjoint files (`metadata.owns`; the builder rejects overlaps).

## 4. Rules every story follows

The guardrails and gates are generated into every PRD (`build_prds.py`):

- **Offline.** Tests use recorded fixtures (`DIRECTOR_REPLAY=1`). The only network use is `npm install`.
- **No git, no deploy, no publish.** The owner commits.
- **The engine is a dependency**, never edited. Gaps go to `ENGINE-NEEDS.md`.
- **Own your files.** Edit what the story names; `shared/` is a contract.
- **Real results only.** Never invent measurements.
- Acceptance criteria always end with `npm run typecheck`, `npm test` and `npm run lint`. UI stories add a browser check.

## 5. Writing or changing stories

1. Edit `ralph/src/prd-<name>.json` (shape: `src/_example.json`).
2. `python3 ralph/build_prds.py` builds every `ralph/prd-*.json` and validates:
   - ids `US-001…`, in order; `dependsOn` only points to earlier stories
   - ≥ 2 concrete `steps` (first one a "Read …" step), ≤ 12 steps; ≥ 2 verifiable `acceptance` criteria; no vague wording
   - no step that runs a live or paid call; no `curl` to a URL
   - no two PRDs own the same path
3. Commit the source, the generated `prd-*.json` and the generated task view `views/<prd>.md` (a readable checklist of the PRD) together.

**Story size.** One story = one iteration: one concern, at most ~4 files, describable in 2–3 sentences. If it needs more, split it.
**Verifiable criteria.** State inputs and outputs ("`secToFrames(2, 30)` returns 60"), not feelings ("works correctly").

## 6. Manual gates: live and paid checks

Ralph never spends money. Each PRD lists its live checks in `metadata.manualGates`.
They are scripts under `scripts/live/<step>.ts`, run through one dispatcher that **prints the estimate and does nothing unless `--yes` is given**:

```bash
npm run live -- s04-art            # prints what it would do and the estimated cost
npm run live -- s04-art --yes      # does it
```

| Gate | Script | Estimated spend | Who |
|------|--------|-----------------|-----|
| S2 smoke (one call per Meta client) | `s02-smoke` | < $0.10 | owner |
| S3 live brief → film | `s03-director` | ≈ $0.20 per film | owner |
| S4 live art + cut-outs | `s04-art` | ≈ $0.30 | owner |
| S5 live review + calibration | `s05-review` | ≈ $0.30 | owner |
| S6 live scripted edits | `s06-chat` | ≈ $0.20 | owner |
| S7 one real clip (Clippy credits) | `s07-generate` | 25 Clippy credits + < $0.05 | owner, per clip |
| S9 local Glimmer run (Ollama) | `s09-local` | $0 | owner |
| S11 MCP server: one film + one edit through an MCP client | `s11-mcp` | ≈ $0.25 | owner |
| S12 MG-1 Wonder as a tool-calling showrunner (5 turns) | `s12-wonder` | ≈ $0.30 (ceiling $1) | owner, **first** |
| S12 MG-2 one crew film with a mid-build message | `s12-crew` | ≈ $1 | owner |
| S12 MG-3 sequential vs crew (Spark lead) vs crew (Wonder lead) | `s12-crew --ab` | ≈ $3 | owner |
| S13 MG-1 one film with a 3D hero scene; realism score | `s13-3d` | ≈ $0.40 | owner |
| S8 deploy | (platform commands in `deploy/README.md`) | hosting | owner |

Record each live result in the PR description. Never paste keys or signed URLs.

## 7. Review checklist for a finished PRD branch

- [ ] Every story `passes: true`, or the `notes` of any that doesn't explain why
- [ ] `git diff --stat main...` touches only the paths in `metadata.owns`, the files named in `metadata.sharedEdits` (each limited to the stated small edit), the PRD file itself and `ENGINE-NEEDS.md`. Stub files that S2 created and a later PRD fills (for example `server/http/handlers/chat.ts`, `web/src/panels/BackendBadge.tsx`) count as that PRD's own files even though S2's `owns` does not list them
- [ ] `npm run typecheck && npm test && npm run lint` pass on a clean `npm ci`
- [ ] `ENGINE-NEEDS.md` rows reviewed (patch the engine and republish, or accept the workaround)
- [ ] No secrets: `gitleaks detect --no-git --source .`
- [ ] The manual gates for this PRD are run and recorded
- [ ] Merge, then `git rebase main` the branches of the PRDs that were waiting on this one

## 8. When Ralph gets stuck

| Symptom | Likely cause | What to do |
|---------|--------------|-----------|
| Same story fails twice | Story too big, or a wrong assumption in the spec | Read its `notes`; split the story in `src/`, rebuild; or fix the spec doc and rerun |
| `notes: blocked: engine` | The engine lacks something | Decide in `ENGINE-NEEDS.md`; patch + republish, or add a workaround story |
| Tests need network | A story forgot the fixtures | Record the fixture once with `DIRECTOR_RECORD=1` via the live script; commit the redacted fixture |
| Merge conflict in `package.json` | Two PRDs added dependencies | S2 pre-installs every dependency named in the design docs; add the missing one on `main`, then rebase |
