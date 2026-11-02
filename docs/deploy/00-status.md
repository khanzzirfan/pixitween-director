# Deploy status and notes: read this first

Last updated: Mon 2 Nov 2026. Branch: `feat/stage3d-uplift` (nothing committed by Claude; commits are the owner's).

## Decision

**We are not deploying anything now.** These documents are the prepared notes for when that decision changes. Nothing in them has been run against production, and no step is scheduled.

## What exists today

| Item | State |
|---|---|
| Product name | **MuseReels** (header, tab title, README, deploy files) |
| Fly app `musereels` | Created (personal organisation, region `iad`), **no machine, no deploy, no secrets** |
| Fly volume `director_data` | Created, 1 GB, encrypted, scheduled snapshots. **This is the only thing that can bill** while nothing runs. |
| `flyctl` | Installed at `~/.fly/bin` (v0.5.1); not on your shell PATH until you add it to `~/.zshrc` |
| GitHub workflow | `.github/workflows/deploy.yml` exists, **manual run only** (no deploy on push) and needs the `FLY_API_TOKEN` secret, which is not set |
| Local servers | You run the app yourself at `http://localhost:5173/` (web) and `:8787` (API) |

Earlier test apps `musereels` (first attempt) and `shelfreel` were destroyed; only the current `musereels` remains.

## To stop all Fly billing

```bash
fly apps destroy musereels -y
```

Then `fly apps list` should be empty. The volume belongs to the app; confirm with `fly volumes list -a musereels` before destroying if you want to see it first.

## Hosting facts (so nobody mixes them up)

- **Fly.io hosts the app:** one container (built web app + Node server + ffmpeg), one machine, one 1 GB volume at `/data`.
- **Baseten does not host it.** It only serves the optional Muse Spark Open model for chat edits (`BASETEN_API_KEY`, `EDIT_BACKEND=spark-open`).
- **Meta API** (`META_API_KEY`) serves the Muse models the crew uses. **Clippy** (`CLIPPY_MCP_URL`, `CLIPPY_TOKEN`) is optional generate mode; the deploy README no longer requires it.
- Fly has no real free tier for new accounts. This repository states no price: check Fly's pricing page for a shared-cpu-1x machine with 1 GB and a 1 GB volume.

## If you decide to deploy later (the order)

1. Merge `feat/stage3d-uplift` into `main` yourself. The workflow deploys whatever is on the branch it is run from, and `main` currently lacks this UI.
2. `fly secrets set -a musereels META_API_KEY=<your key> DIRECTOR_PASSCODE=<your passcode>` (you type the values).
3. `npm run build && npx tsx deploy/predeploy-check.ts`, then `fly deploy -a musereels` from the checkout, or run the GitHub workflow after saving a deploy token (`fly tokens create deploy -a musereels`) as the secret `FLY_API_TOKEN`.
4. Verify and tear down with [02-deploy-today-runbook.md](02-deploy-today-runbook.md).

## The other notes

- [01-deployment-spec.md](01-deployment-spec.md): goals, decisions, architecture, configuration matrix, costs, risks, acceptance criteria.
- [02-deploy-today-runbook.md](02-deploy-today-runbook.md): the commands in order, written for a deploy day.
- [03-preflight-checklist.md](03-preflight-checklist.md): tick-box checklist.
- [04-musereels-name-and-ci-spec.md](04-musereels-name-and-ci-spec.md): the name and the GitHub Actions deploy.
- [../../deploy/README.md](../../deploy/README.md): the short command reference that sits beside the Dockerfile.
