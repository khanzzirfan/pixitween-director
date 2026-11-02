# Pre-flight checklist (print or tick in place)

> Not scheduled: we are not deploying now. See [00-status.md](00-status.md).

Use with [02-deploy-today-runbook.md](02-deploy-today-runbook.md). Tick only what you saw pass.

## Accounts and tools
- [ ] `fly version` works; `fly auth whoami` shows the right account
- [ ] Fly payment method added; price of shared-cpu-1x 1 GB + 1 GB volume accepted
- [ ] `docker version` works
- [ ] Meta credits remain (check balance; $150 granted)
- [ ] Baseten credits remain (only if using Spark Open)

## Code
- [ ] Right commit checked out, working tree clean
- [ ] S12a to S12c merged (crew in); `npm ci` OK
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green
- [ ] `npm run build` OK, then `npm run check:bundle` OK
- [ ] `npx tsx deploy/predeploy-check.ts` prints `predeploy check passed`, no rename warning
- [ ] `engine` dependency installed at `reacthub-pixitweenjs@^0.3.0-alpha.5` (see `package.json`)

## Config
- [ ] `fly.toml`: unique `app`, `PUBLIC_BASE_URL` matches, crew vars added
- [ ] `SHOWRUNNER_MODEL` confirmed (`muse-wonder-1.0` in `fly.toml`)
- [ ] No key, token or passcode in `fly.toml`, `deploy/Dockerfile`, git history or chat

## Secrets (set on Fly)
- [ ] `META_API_KEY`
- [ ] `DIRECTOR_PASSCODE`
- [ ] `BASETEN_API_KEY` (optional)
- [ ] `fly secrets list -a <app>` shows the names (values hidden)

## Go-live
- [ ] `fly deploy` finished, `fly status` healthy
- [ ] `/api/health`: `ok`, `metaConfigured`, `ffmpeg` all true, `replay` false
- [ ] Private window: gallery and replay work, logged out
- [ ] One crew film made with the passcode on the live URL
- [ ] Creation without a passcode refused
- [ ] Restart keeps films
- [ ] 375 px layout OK, both themes
- [ ] Gallery seeded; best film featured
- [ ] Volume snapshot taken
- [ ] Submission link updated with `https://<app>.fly.dev`
- [ ] Teardown reminder set for 16 Nov 2026

## Known open items (not blockers unless you want them closed)
- The repo states no Fly price; the owner confirms it on Fly's pricing page.
- `fly ssh console`, `fly secrets set`, `fly machine restart` and `fly volumes snapshots` syntax is unverified in this repo; use each command's `--help`.
- `fly apps destroy` may not remove the volume; list and destroy explicitly.
- 3D product shots are off by default (`PRODUCT_3D`); set it to `true` in `fly.toml` only if the demo needs them, and test them before relying on them.
