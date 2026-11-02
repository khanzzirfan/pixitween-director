# Deploy-today runbook

> **Not scheduled: we are not deploying now.** Read [00-status.md](00-status.md) first. This is the prepared order of steps for a deploy day; do not run it until that decision changes.

Companion to [01-deployment-spec.md](01-deployment-spec.md) and the command reference in [../../deploy/README.md](../../deploy/README.md). Run top to bottom. Every command is yours to run; stop at the first failure.

Replace `<app>` with your unique Fly app name (for example `musereels`).

## 0. Before you start (15 min)

- [ ] Checkout is on the commit you want live (`git status` clean, branch is `main` or the integration branch that contains S12a to S12c).
- [ ] Docker is running (`docker version`). Verified present at `/usr/local/bin/docker`.
- [ ] Fly CLI works: flyctl v0.5.1 is installed at `~/.fly/bin` (add it to your PATH), `fly version` answers.
- [ ] Logged in: `fly auth login`; `fly auth whoami` shows your account.
- [ ] Payment method added at fly.io dashboard (required to create a machine).
- [ ] Looked at Fly's current price for a shared-cpu-1x 1 GB machine and a 1 GB volume, and you accept it.
- [ ] Decide `SHOWRUNNER_MODEL`: `fly.toml` sets `muse-wonder-1.0`; use `muse-spark-1.3-contributor` if Wonder is unavailable.

## 1. Local gate (10 min)

```bash
npm ci
```

```bash
npm run typecheck && npm run lint && npm test
```

```bash
npm run build
```

```bash
npm run check:bundle
```

```bash
npx tsx deploy/predeploy-check.ts
```

Expected: `predeploy check passed`, plus a warning "rename the app" until step 2 is done.

## 2. Rename the app and set config (5 min)

Edit [fly.toml](../../fly.toml):

1. `app = "<app>"`
2. `PUBLIC_BASE_URL = "https://<app>.fly.dev"`
3. Add under `[env]`:
   ```toml
   CREW_ENABLED = "true"
   SHOWRUNNER_MODEL = "muse-wonder-1.0"   # or muse-spark-1.3-contributor
   FILMS_STARTS_PER_WINDOW = "2"
   CREW_FILM_BUDGET_USD = "1.5"
   ```
4. Re-run `npx tsx deploy/predeploy-check.ts`: the rename warning should be gone.

Note: [deploy/fly-config.test.ts](../../deploy/fly-config.test.ts) checks the config keys; run `npx vitest run deploy` after editing.

## 3. Optional local container test (10 min)

```bash
docker build -f deploy/Dockerfile -t musereels .
```

```bash
docker run --rm -p 8080:8080 -v "$PWD/.docker-data:/data" -e DATA_DIR=/data -e DIRECTOR_PASSCODE=local-test musereels
```

In another terminal: `curl localhost:8080/api/health` should return `ok:true` and `ffmpeg:true` (`metaConfigured:false` is expected with no key). Stop with Ctrl+C and delete `.docker-data`.

## 4. The app and volume (already created)

The `musereels` app and the `director_data` volume already exist on Fly (see 00-status.md), so skip these two commands unless you destroyed them. They are kept here for a rebuild.

```bash
fly launch --no-deploy --copy-config --name <app> --region iad
```

```bash
fly volumes create director_data --region iad --size 1 -a <app>
```

If `fly launch` offers to overwrite `fly.toml` or add a database/Redis, say no.

## 5. Set secrets (2 min)

Confirm syntax with `fly secrets set --help`, then (type values yourself):

```bash
fly secrets set -a <app> META_API_KEY=<your key> DIRECTOR_PASSCODE=<your passcode>
```

```bash
```

Optional, only for the open-weight edit demo:

```bash
fly secrets set -a <app> BASETEN_API_KEY=<your key> EDIT_BACKEND=spark-open
```

`EDIT_BACKEND` is not a secret; you may put it in `[env]` instead.

## 6. Deploy (5 to 10 min)

```bash
fly deploy -a <app>
```

```bash
fly status -a <app>
```

```bash
fly logs -a <app>
```

Look for the server listening on 8080 and a passing health check. First build is slow (npm ci + vite build in the image).

## 7. Verify (15 min)

Run the nine acceptance criteria in section 7 of the spec:

```bash
curl -s https://<app>.fly.dev/api/health
```

Then in a **private browser window**:
1. Gallery loads, newest first; open `?film=<id>` and it replays.
2. Try to create a film with no passcode: refused.
3. Enter the passcode and create one crew film. Watch the live storyboard and crew board. This spends Meta credits (about $1.50 cap).
4. Create films from the same address until the 4th in an hour gives a 429 (or trust the unit tests and skip to save credits).
5. `fly machine restart -a <app>` (check `fly machine --help` for syntax), reload: films still there.
6. Resize to 375 px: no sideways scroll, light and dark.

## 8. Seed the gallery (5 min)

So judges see something even if a live film fails:

```bash
fly ssh console -a <app> -C "env DATA_DIR=/data npx tsx scripts/seed-gallery.ts"
```

Syntax is unverified; check `fly ssh console --help`. Then feature the best crew film in the gallery (NEXT-STEPS.md MG-4: run the demo script twice, keep the best).

## 9. Safety net

- Snapshot the volume once films are in: `fly volumes list -a <app>` then `fly volumes snapshots create <volume id>` (verify with `fly volumes snapshots --help`).
- Keep the local fallback: `?replay=1` on localhost:5173 plays the recorded demo if Fly misbehaves.
- Roll back a bad deploy: `fly releases -a <app>` then `fly deploy -a <app> --image <previous image>`.
- Crew misbehaving live: set `CREW_ENABLED=false` in `[env]` and redeploy; new films use the single director.
- Wonder failing: set `SHOWRUNNER_MODEL=muse-spark-1.3-contributor` and redeploy.
- Rate limit hit: lower `FILMS_STARTS_PER_WINDOW` to 1 or raise `FILMS_WINDOW_SEC`.

## 10. Teardown (on or after Mon 16 Nov 2026)

Set the calendar reminder now. Then:

```bash
fly apps destroy <app> -y
```

```bash
fly volumes list -a <app>
```

```bash
fly apps list
```


## Time estimate

About 75 minutes end to end if tests pass first time; most of it is the image build and the one paid verification film.
