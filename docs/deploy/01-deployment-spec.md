# Deployment spec: MuseReels on Fly.io

Status: **reference only; we are not deploying now** (see [00-status.md](00-status.md)). The owner runs every command; nothing here is run for them (hackathon rule: no deploys or paid calls without a yes).
Judging window: 5 to 16 Nov 2026. If a deploy happens, teardown is on or after 16 Nov 2026.

## 1. Goal

Put one public URL in front of judges that:
- loads the gallery without a login and replays finished films;
- lets the owner (passcode) create a film with the Muse crew (Wonder showrunner + parallel Spark builders);
- stays up and warm for the whole judging window, and survives a machine restart without losing films;
- never exposes a key in the browser bundle, the image or the repository.

Non-goals: autoscaling, multiple regions, a custom domain, CI/CD, a database. One machine, one volume.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Host on **Fly.io**, one Docker machine, region `iad` | Already configured in `fly.toml` and `deploy/Dockerfile`; persistent volume; always-on machines. |
| D2 | **Baseten is not a host.** It only serves Muse Spark Open for chat edits (optional) | It is an inference API paid by hackathon credits. |
| D3 | Films live on a 1 GB Fly volume at `/data` (`DATA_DIR=/data`) | File-based stores; no database to run. |
| D4 | `auto_stop_machines = "off"`, `min_machines_running = 1` | No cold start for judges. Costs a little more; worth it. |
| D5 | Secrets only via `fly secrets set`; plain config via `[env]` in `fly.toml` | Predeploy check fails the deploy if a key leaks into the bundle or config. |
| D6 | Creation is gated by `DIRECTOR_PASSCODE`; gallery and replay are public | Without a passcode anyone can spend the Meta credits. |
| D7 | Crew on (`CREW_ENABLED=true`) with tight admission limits | Protects the Meta rate limit (150 requests per window; one film budgeted at 40). |

## 3. Architecture

```
Browser ──https──> Fly edge (force_https, client-IP header trusted) ──> machine (shared-cpu-1x, 1 GB)
                                                                         │  node:22 + ffmpeg, `npm start` (tsx server/main.ts)
                                                                         │  serves web/dist + /api/*
                                                                         ├── /data  (Fly volume `director_data`, 1 GB): films, assets, ledger
                                                                         ├──> Meta Model API   (META_API_KEY: Spark, Wonder, image/SAM)
                                                                         └──> Baseten          (BASETEN_API_KEY: optional, EDIT_BACKEND=spark-open)
```

Health: `GET /api/health` returns `{ok, version, metaConfigured, ffmpeg, validator, replay, ...}`; Fly polls it every 30 s (grace 20 s).

## 4. Configuration matrix

Secrets (`fly secrets set`, never in a file):

| Name | Required | Notes |
|---|---|---|
| `META_API_KEY` | Yes | Without it the director cannot build films; `/api/health` shows `metaConfigured:false`. |
| `DIRECTOR_PASSCODE` | Yes | Choose a passcode you can type on stage; share only with the owner. |
| `BASETEN_API_KEY` | Only for Spark Open edits | Also set `EDIT_BACKEND=spark-open`. Skip if not demoing the open-weight bonus. |

Plain env (`[env]` in `fly.toml`):

| Name | Value | Status in `fly.toml` |
|---|---|---|
| `PORT` | `8080` | set |
| `NODE_ENV` | `production` | set |
| `DATA_DIR` | `/data` | set |
| `TRUST_FLY_CLIENT_IP` | `true` | set |
| `PUBLIC_BASE_URL` | `https://<app>.fly.dev` | **must change with the app name** |
| `CREW_ENABLED` | `true` | add (default is already on; explicit is safer) |
| `SHOWRUNNER_MODEL` | `muse-wonder-1.0`, or `muse-spark-1.3-contributor` if Wonder is unavailable | set to `muse-wonder-1.0` in `fly.toml` |
| `FILMS_STARTS_PER_WINDOW` | `2` | set in `fly.toml` (the code default is 3) |
| `PRODUCT_3D` | `true` only if 3D product shots are wanted | not set; code default is off |
| `CREW_FILM_BUDGET_USD` | `1.5` | add (cap per film) |
| `FILMS_IN_FLIGHT_MAX` / `FILMS_QUEUE_MAX` | `2` / `4` | defaults; leave |
| `FILMS_PER_HOUR_PER_IP` | `3` | default; the README verify step expects a 429 on the 4th |

Never set `DIRECTOR_REPLAY` or `DIRECTOR_RECORD` in production.

## 5. Cost and credits

| Item | Paid by | Notes |
|---|---|---|
| Fly machine (shared-cpu-1x, 1 GB) + 1 GB volume | **Owner's card** | Fly needs a payment method. Check Fly's pricing page before approving; this repository states no number. A two-week run should be a few dollars. |
| Meta API calls | $150 Meta credits | One film budget about $1.50 with the crew; the per-film cap is `CREW_FILM_BUDGET_USD`. |
| Baseten Spark Open | Hackathon credits ($100) | Optional. |

Worst-case Meta spend while public is bounded by: `FILMS_STARTS_PER_WINDOW` x `CREW_FILM_BUDGET_USD` per window, plus the per-IP and passcode gates.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Key leaks into bundle or image | `npx tsx deploy/predeploy-check.ts`; `npm run check:bundle`; `.dockerignore` excludes `.env`, `data`, `debug`. |
| Judges burn the Meta rate limit | Admission queue and window limits (section 4); the queue answers 429 instead of failing mid-film. |
| Volume lost or full | 1 GB is plenty for demo films; take a `fly volumes snapshots` check (section 8 of the runbook) before judging. |
| App name already taken on Fly | `fly launch` fails fast; pick another name and update `PUBLIC_BASE_URL`. |
| Wonder model unavailable | Fall back with `SHOWRUNNER_MODEL=muse-spark-1.3-contributor`; no code change. |
| Cost forgotten | The `director_data` volume already exists and bills even with no machine. `fly apps destroy musereels -y` removes it. If deployed, also set the 16 Nov teardown reminder (runbook section 10). |
| `fly` not on your shell PATH | flyctl v0.5.1 is installed at `~/.fly/bin`; add `export PATH="$HOME/.fly/bin:$PATH"` to `~/.zshrc`. Logged in as the owner's account. |

## 7. Acceptance criteria (done = all true)

1. `https://<app>.fly.dev/api/health` returns `ok:true`, `metaConfigured:true`, `ffmpeg:true`, `replay:false`.
2. Logged out, in a private window: gallery loads, a featured film replays via `?film=<id>`.
3. With the passcode: one crew film completes on the live URL.
4. Without the passcode: creating a film is refused.
5. The 4th film creation from one address within an hour returns 429.
6. `fly machine restart` leaves the gallery and films intact.
7. Browser bundle contains no key name or token (`predeploy-check` and `check:bundle` pass).
8. 375 px wide: no sideways scroll in light and dark themes.
9. Teardown reminder exists for 16 Nov 2026.
