# MP4 export

Export any film as an H.264 MP4 from the **Export** tab. Nothing to install: open the film in Chrome, choose **MP4**, press **Export video**.

## How to export

1. Open a film (`/?film=<id>`), go to the **Export** tab.
2. Choose **MP4** in the Format list and press **Export video**. The panel shows `Rendering frame N of M`.
3. Keep the tab in the foreground until it finishes: a hidden tab stops drawing, so the export waits.
4. Download the file. Any notes under the link are the checks below.

The MP4 option is hidden when neither path below is available; WebM always works.

## How it works

The browser draws every frame itself, on its own GPU. It pauses the film, **seeks to frame `i / fps`, waits two animation frames for the draw, and reads the canvas**. Nothing plays in real time, so a slow machine is slower, never choppier, and the 3D camera moves land on exact frames.

| Path | When | Encoder | Sound |
|------|------|---------|-------|
| **Browser** | the browser has WebCodecs H.264 (Chrome, Edge, recent Safari) | Mediabunny in the page | yes, mixed from the composition |
| **Server** | no WebCodecs (older Safari, Firefox) and the server has ffmpeg | the page uploads one JPEG per frame to `/api/exports`; the server's ffmpeg encodes (`libx264`, `yuv420p`, limited range, `+faststart`) | no |

After either path, the server's ffprobe **checks the MP4** (`POST /api/exports/check` for the browser path, done inside `finish` for the server path).

### Routes

All behind the passcode, like every write.

- `POST /api/exports` `{ fps, frames, width, height }` → `201 { id }`
- `PUT /api/exports/:id/frames/:i` (`image/jpeg`, at most 4 MB) → `204`
- `POST /api/exports/:id/finish` → the MP4 (`video/mp4`) with the check in the `x-export-problems` header (a JSON array)
- `POST /api/exports/check?durationSec=&fps=&width=&height=` (the MP4 as the body, at most 200 MB) → `{ problems }`

Errors: `503 ffmpeg_missing`, `404 no_such_export`, `409 missing_frames`, `413 payload_too_large`, `429 busy` (two exports are open at once). A session lives in a temp folder and is deleted on finish, on error and after 10 minutes idle; nothing is written to the data folder.

## What the notes mean

| Note | Meaning |
|------|---------|
| `duration A s, expected B s` | the MP4 is more than 0.15 s off the film's length |
| `size WxH, expected WxH` | the picture size differs by more than 1 px |
| `frames N, expected M` | the frame count differs by more than 2 |
| `frozen: frames at A s and B s are identical` | nine evenly spaced frames were sampled and two neighbours match exactly. It can be a real hold (an end card, a pending-approval card), so look before you worry |
| `check failed: …` | ffprobe could not read the file |

## Limits

- The server path is silent. The browser path keeps the sound.
- The tab must stay visible while it exports.
- Flat cut-out products show only their front.
- The server keeps at most two exports open at once.
- Timings and sizes are not measured on a judge's machine yet; see the gates.

## Run it yourself

ffmpeg is optional locally: without it the browser path still works in Chrome.

```bash
brew install ffmpeg          # macOS
sudo apt install ffmpeg      # Debian or Ubuntu
```

The Fly image already installs ffmpeg (`deploy/Dockerfile`). `GET /api/health` reports `ffmpeg: true` when the server can see it.

## Manual gates (owner)

- **MG-1** (Chrome, local): open a 3D film, export MP4, play it in QuickTime and Chrome. Same camera moves as the player, audio in sync by eye, no unexpected frozen stretch.
- **MG-2** (server path): in devtools run `delete window.VideoEncoder`, reopen the Export tab, export again. The file must play and be silent.
- **MG-3** (Fly, after you deploy): export one film by each path on the deployed app; `/api/health` must say `ffmpeg: true`.
- **MG-4**: compare frames at 1 s, 4 s and 7 s of the MP4 with the player paused at those times.
