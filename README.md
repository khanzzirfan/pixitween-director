# 🎬 PixiTween Director

**One product photo in. An animated, editable film out, playing live in your browser.**

`brief ✍️ → storyboard 🧠 → scenes 🎨 → layers ✂️ → timeline 🎞️ → self-check 🔍 → chat edits 💬`

> 🚧 **Just getting started at the Meta Global AI Developer Hackathon.** The plan is done and the first build wave is starting.
> There is no working app in this repo yet. Star ⭐ or watch 👀 to follow along as it goes up.

---

## 💡 The idea

Most AI video tools give you a flat MP4. If one word is misspelled or the logo sits in the wrong corner, you
generate the whole clip again and hope.

PixiTween Director makes the film as **code**: a layered animation timeline, written by a Muse Spark agent, that
plays straight away in the browser on our open-source PixiJS engine.

- 🧩 **Every layer stays editable.** The product, the background, the text and the motion are separate.
  Change one by chat or by clicking it on the canvas.
- 🔤 **Text is always spelled right.** Captions and titles are real text in the timeline, not pixels a model drew.
- ⚡ **Instant preview.** The browser player *is* the preview. There's no render server and no queue.
- 💸 **Cents per film.** It only spends on generated video when a shot really needs real-world motion, and only
  after you approve the price.

## 🦙 Meta models, each with one job

| Role | Model | What it does |
|------|-------|--------------|
| 🧠 Director | **Muse Spark** | Reads the brief and the photo, plans the storyboard, writes the timeline through tool calls, builds scenes in parallel |
| 🎨 Art department | **Muse Image** | Draws each scene's world: the café, the desk, the morning light |
| ✂️ Cutting room | **SAM 3.1** | Cuts the product and people out into separate layers, so they can move on their own |
| 🔍 Second pair of eyes | **Muse Spark** | Looks at frames of the finished film, checks them against measured rules, and fixes what's wrong |
| 🏠 Local mode | **Muse Glimmer** (open weights, Ollama) | Runs the director on your own machine: private, offline, free |

Early probes on 27 Oct: Spark fired 6 tool calls in parallel per scene (about 18 s a scene), 16 scenes at once all
came back fine, and SAM 3.1 returned clean full-resolution cut-outs.

## 🛠️ How it works

```
📸 product photo + ✍️ brief
        │
        ▼
🧠 Muse Spark ── storyboard ──► scene builders (in parallel)
        │                          │
        │                 🎨 Muse Image draws the scene
        │                 ✂️ SAM 3.1 cuts out the layers
        ▼                          │
🎞️ timeline JSON ◄─────────────────┘
        │
        ▼
▶️ plays live in the browser (PixiJS)
        │
        ▼
🔍 self-check: measured rules first, then Spark looks at the frames
        │       (caption over the product? text off-frame? a word shown too briefly?)
        ▼
💬 you keep directing by chat: "slower in scene 2", "move the logo here"
        │
        ▼
🎥 generate mode (optional): one approved video clip from a video model, placed into the timeline
```

## 🗺️ Roadmap

| | Milestone | Target |
|---|-----------|--------|
| ✅ | Plan, contracts and specs written; every Meta model probed live | Tue 27 Oct |
| ✅ | Engine `reacthub-pixitweenjs@0.3.0-alpha.3` published to npm | Wed 28 Oct |
| 🏗️ | Skeleton: Meta clients, film store, browser player | Wed 28 Oct |
| ⏳ | **M1**: a brief becomes a playing film, and the self-check fixes one thing | Sat 31 Oct |
| ⏳ | Chat editing, frame review, Local mode on Glimmer | Sun 1 Nov |
| ⏳ | **M2**: live demo URL, with generate mode | Mon 2 Nov |
| ⏳ | **M4**: submitted 🚀 | Wed 4 Nov |

## 🧱 Built during the hackathon

Everything in this repository is written from scratch for the Meta Global AI Developer Hackathon, starting on
28 Oct 2026. The git history is the record.

One thing comes from outside, as a published dependency:
**[`reacthub-pixitweenjs`](https://www.npmjs.com/package/reacthub-pixitweenjs)**, our existing open-source
PixiJS animation engine (Apache-2.0). It is installed from npm and never copied or edited here. Anything the
director needs from it is listed in [`ENGINE-NEEDS.md`](ENGINE-NEEDS.md).

## 🤝 Ground rules

- 🔑 API keys stay on the server. The browser never sees them.
- 💰 Every paid call has a price shown first, and generated video needs a yes.
- 🖼️ Only assets we own or that are openly licensed ([`ASSET-CREDITS.md`](ASSET-CREDITS.md)). No real brands,
  logos or people's likenesses.

## 📜 Licence

[Apache-2.0](LICENSE)

---

<sub>🏆 Meta Global AI Developer Hackathon 2026 · Track: Startups · Theme: Build for Your World</sub>

---

## 🧰 Development

**Prerequisites:** Node 22. `ffmpeg` is optional (the tests that need it skip without it).

**Setup**

```bash
npm ci
cp .env.example .env   # then fill in META_API_KEY (the app and tests run without it)
```

**Scripts**

| Script | What it does |
|--------|--------------|
| `npm run dev` | Runs the server (`tsx watch`, port 8787) and the web app (Vite, port 5173) together |
| `npm run dev:server` | Server only |
| `npm run dev:web` | Web app only; open `http://localhost:5173/?fixture=1` to play the fixture compositions |
| `npm run build` | Builds the web app into `web/dist` (the server serves it) |
| `npm run check:bundle` | Scans `web/dist` for API key names, values and `Bearer`/`sk-` strings; run it after `npm run build` |
| `npm run typecheck` | `tsc` over `server/` and `web/` |
| `npm run lint` | ESLint |
| `npm test` | Vitest, offline (no network) |
| `npm run live -- <name> [--yes]` | Live or paid checks. A dry run by default: it prints the estimate and stops unless you pass `--yes` |

**Layout**

| Folder | Holds |
|--------|-------|
| `shared/` | Contracts used by server and web: film state, storyboard, events, tool and port interfaces |
| `server/` | Hono API, stores, Meta clients, tool registry, test doubles |
| `web/` | Vite + React app and the Player |
| `scripts/` | The live-check dispatcher and the bundle key scanner |
| `fixtures/` | Recorded real-shape responses (`seed/`) and hand-made compositions (`s02/`) |
| `docs/`, `ralph/` | Specs and the build plan |

**Live checks:** `npm run live -- s02-smoke` prints what it would call and what it would cost. Only `--yes` spends.

**Licences:** this repo is Apache-2.0. The engine `reacthub-pixitweenjs` is Apache-2.0. `@meta-sam/parser` is under the SAM License, not Apache. The Meta models are used through the Meta Model API under its terms.

<!-- S10 completes: Built during the hackathon / Pre-existing dependencies -->
