# Spec: MuseReels app name and GitHub Actions deploy

Status: written on `feat/stage3d-uplift`, not committed. **Not deploying now** (see [00-status.md](00-status.md)). Extends [01-deployment-spec.md](01-deployment-spec.md); where they disagree on the app name, this file wins.

## 1. Name

The product is **MuseReels**. The Fly app is `musereels` (Fly names are lowercase) at `https://musereels.fly.dev`.

| Where | Value |
|---|---|
| `fly.toml` `app` | `musereels` |
| `fly.toml` `PUBLIC_BASE_URL` | `https://musereels.fly.dev` |
| `deploy/README.md` Docker tag | `musereels` |
| Browser tab title and header | MuseReels (`web/index.html`, `web/src/shell/StudioShell.tsx`) |

Not renamed: the GitHub repo, `package.json` name and the engine (`reacthub-pixitweenjs`), which are internal identifiers.

`fly.toml` also gains the crew settings: `CREW_ENABLED`, `SHOWRUNNER_MODEL`, `CREW_FILM_BUDGET_USD` and `FILMS_STARTS_PER_WINDOW`.

## 2. State on Fly

- App `musereels` (personal organisation) with a 1 GB `director_data` volume in `iad`. No machine yet, so nothing runs; only the volume bills.
- No secrets set and nothing deployed.
- Earlier test apps (a first `musereels` and `shelfreel`) were destroyed while the name was being settled.

## 3. GitHub Actions deploy

File: [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml).

- Trigger: **run by hand only** (`workflow_dispatch`). Nothing deploys on a push, because we are not deploying now.
- Job `check`: `npm ci`, typecheck, lint, tests, build, `check:bundle`, `deploy/predeploy-check.ts`. A failure stops the deploy.
- Job `deploy` (after `check`): `flyctl deploy --remote-only` with the `FLY_API_TOKEN` secret. It uses a GitHub `production` environment, so you can require a reviewer.
- One deploy at a time; the workflow token is read-only.

One-time setup (yours):
1. `fly tokens create deploy -a musereels`, then save it as the GitHub repository secret `FLY_API_TOKEN`.
2. Optional: Settings, Environments, `production`, add a required reviewer.
3. `fly secrets set -a musereels META_API_KEY=<your key> DIRECTOR_PASSCODE=<your passcode>`.

**Important:** run it from a branch that has this UI. `main` does not have it yet, so merge `feat/stage3d-uplift` into `main` first (the owner's step) or run the workflow from this branch.

## 4. Acceptance

1. `fly apps list` shows `musereels`; `fly volumes list -a musereels` shows `director_data`; `musereels` is gone.
2. `npx vitest run deploy` and `npx tsx deploy/predeploy-check.ts` pass.
3. After the first deploy, `https://musereels.fly.dev/api/health` returns `ok:true`.

## 5. Teardown (16 Nov 2026)

Runbook section 10, plus: delete the `FLY_API_TOKEN` secret, revoke the deploy token, and disable the workflow.
