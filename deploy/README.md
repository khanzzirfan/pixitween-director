# Deploying PixiTween Director on Fly.io

One small container: the built web app and the Node server, with a 1 GB volume for films. Nothing here is run for you; these are the commands to run yourself.

## Prerequisites

- `flyctl` installed and logged in (`fly auth login`).
- A payment method on your Fly account.
- Price a shared-cpu-1x machine with 1 GB of RAM and a 1 GB volume on Fly's pricing page before you approve the cost. This repository states no number.
- Keys ready: your Meta API key, a passcode for creating films, and the Clippy URL and token if you want generate mode.

## Pre-deploy checks

```bash
npm ci
npm run build
npx tsx deploy/predeploy-check.ts
```

The check fails if `web/dist` is missing, if a key, token or server-only variable name shows up in the built web app or in `deploy/Dockerfile` or `fly.toml`, or if `.dockerignore` does not exclude `.env` and `data`. It warns while `fly.toml` still has the default app name.

Optional local test of the container, with a data folder you can throw away:

```bash
docker build -f deploy/Dockerfile -t pixitween-director .
docker run --rm -p 8080:8080 -v "$PWD/.docker-data:/data" -e DATA_DIR=/data pixitween-director
```

## Create the app

Rename the app in `fly.toml` (the name must be unique on Fly) and change `PUBLIC_BASE_URL` to `https://<app>.fly.dev`. Then:

```bash
fly launch --no-deploy --copy-config --name <app> --region iad
fly volumes create director_data --region iad --size 1 -a <app>
```

The volume is mounted at `/data` and `DATA_DIR` points the stores at it, so films survive a restart.

## Secrets

Secrets are set on Fly and never written to a file in this repository. Run `fly secrets set --help` to confirm the syntax for your flyctl version, then:

```bash
fly secrets set -a <app> META_API_KEY=<your key> DIRECTOR_PASSCODE=<your passcode>
fly secrets set -a <app> CLIPPY_MCP_URL=<your clippy url> CLIPPY_TOKEN=<your clippy token>
```

Without a passcode anyone can create films. Without the Clippy values generate mode is unavailable and everything else works.

## Deploy

```bash
fly deploy -a <app>
fly status -a <app>
fly logs -a <app>
```

## Verify

1. `curl https://<app>.fly.dev/api/health` answers without the passcode with `{"ok":true,...}`.
2. Open the site in a private window: the gallery loads, newest first, and `?film=<id>` replays a film.
3. Create a film with the passcode. The fourth creation from one address within an hour gets a 429.
4. Restart the machine (`fly machine restart`) and check the films are still there.
5. At 375 px wide there is no sideways scrolling, in the light and the dark theme.

## Tuning the crew

A film is several Meta API calls, and the Meta key allows 150 requests per window (the window length is not published). A film is budgeted at 40 requests. Four optional settings keep a busy demo slowing down instead of failing; set them as `[env]` entries in `fly.toml`:

| Variable | Default | What it does |
| --- | --- | --- |
| `FILMS_IN_FLIGHT_MAX` | 2 | Films running at the same time |
| `FILMS_QUEUE_MAX` | 4 | Films waiting; one more is refused with a 429 |
| `FILMS_STARTS_PER_WINDOW` | 3 | New films started in one window |
| `FILMS_WINDOW_SEC` | 300 | Length of that window, in seconds |

To recalibrate, read the `x-ratelimit-remaining-requests` header from a one-token chat call before and after one finished film, and adjust the two window settings so a film's budget fits.

## Seed the gallery

To put finished films in the gallery, run the seed script inside the machine with the data on the volume:

```bash
fly ssh console -a <app> -C "env DATA_DIR=/data npx tsx scripts/seed-gallery.ts"
```

The `fly ssh console` syntax is unverified here; check `fly ssh console --help`.

## Teardown

Run this on or after Mon 16 Nov 2026, once the community vote result is in. Set a calendar reminder for 16 Nov 2026.

```bash
fly apps destroy <app> -y
fly volumes list -a <app>
fly apps list
```

Both lists should show nothing for this app. Whether `fly apps destroy` also removes the volume is unverified, so if a volume is still listed, destroy it explicitly with `fly volumes destroy <volume id> -a <app>`.
