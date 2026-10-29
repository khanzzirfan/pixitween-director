# Architecture in a nutshell

How PixiTween Director fits together: the UI, the UI ↔ API contract, the backend and its outside services, and the
**Muse crew** that comes next. It describes the code on `integration` as of 29 Oct 2026. Anything planned but not
built yet is drawn with **dashed** borders and marked *planned*.

- [1. The big picture](#1-the-big-picture)
- [2. The UI](#2-the-ui)
- [3. UI ↔ API](#3-ui--api)
- [4. Sequences](#4-sequences)
- [5. The Muse crew (planned)](#5-the-muse-crew-planned)
- [6. Backend and infrastructure](#6-backend-and-infrastructure)
- [7. Not built yet](#7-not-built-yet)

Colour key used in every diagram:

```mermaid
flowchart LR
  B[Browser]:::web --- S[Server]:::srv --- M[Meta model]:::meta --- X[Other service]:::ext --- D[(Storage)]:::store --- P[Planned]:::plan
  classDef web fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef srv fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef meta fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:2px
  classDef ext fill:#f1f5f9,stroke:#64748b,color:#1e293b
  classDef store fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef plan fill:#ffffff,stroke:#7c3aed,color:#3b0764,stroke-dasharray:5 4
```

## 1. The big picture

One Node process serves both the API and the built web app. The film itself is JSON (a PixiJS timeline) that the
browser plays live, so there is no render server. The browser also does the work only a browser can: it captures
frames for the review and encodes the MP4 export. Every pixel of the film's art comes from a Meta model.

```mermaid
flowchart LR
  subgraph Browser["🖥️ Browser · Vite + React 19 SPA"]
    direction TB
    UI["Panels<br/>new film · storyboard · chat · review · generate · gallery"]:::web
    Player["▶️ Player<br/>reacthub-pixitweenjs (PixiJS + GSAP)"]:::web
    Capture["📸 Frame capture"]:::web
    Export["🎞️ MP4 export<br/>mediabunny"]:::web
    UI --> Player
    Player --> Capture
    Player --> Export
  end

  subgraph Server["⚙️ Node 22 · Hono · one process"]
    direction TB
    API["REST + SSE"]:::srv
    Agents["Director · Edit loop · Review loop · Generate"]:::srv
    Crew["Muse crew<br/>showrunner + job board"]:::plan
    Store[("DATA_DIR<br/>films · versions · events · assets")]:::store
    API --> Agents --> Store
    API -.-> Crew -.-> Store
  end

  UI == "REST · JSON + multipart" ==> API
  API == "SSE · film events" ==> UI
  Capture -- "POST frames" --> API

  subgraph Meta["🦙 Meta Model API"]
    direction TB
    Spark["Muse Spark 1.3<br/>plan · build · edit · review"]:::meta
    Image["Muse Image<br/>scene plates"]:::meta
    SAM["SAM 3.1<br/>cut-outs · clip tracking"]:::meta
    Voice["Voice Transcribe<br/>spoken brief"]:::meta
    Wonder["Muse Wonder<br/>showrunner"]:::plan
  end

  Agents --> Spark & Image & SAM & Voice
  Crew -.-> Wonder

  Glimmer["Muse Glimmer 30B<br/>Ollama · Local mode"]:::meta
  Baseten["Baseten<br/>Muse Spark Open · opt-in edits"]:::ext
  Clippy["Clippy MCP<br/>animate_image · approved clips only"]:::ext
  Agents -. "local" .-> Glimmer
  Agents -. "opt-in" .-> Baseten
  Agents -. "approved" .-> Clippy

  classDef web fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef srv fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef meta fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:2px
  classDef ext fill:#f1f5f9,stroke:#64748b,color:#1e293b
  classDef store fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef plan fill:#ffffff,stroke:#7c3aed,color:#3b0764,stroke-dasharray:5 4
```

Rules that shape everything below:

- **Keys stay on the server.** `META_API_KEY`, `BASETEN_API_KEY` and `CLIPPY_TOKEN` are read only by `server/env.ts`.
  `npm run check:bundle` fails if a key name reaches the browser bundle.
- **The browser never edits a film directly.** Every change goes through the server (director, chat, undo, review,
  generate), which writes a new version and announces it on the event stream.
- **`shared/` is the contract.** zod schemas for the composition, storyboard, events and API bodies are imported by
  both sides, so a contract change fails typecheck on both.
- **The composition JSON is the single source of truth.** Agents never draw pixels; they call typed tools, and every
  write is validated before it is stored.

## 2. The UI

A single page (`web/src/App.tsx`). The film shown comes from the URL (`?film=<id>`); the Gallery changes it without a
reload. Every panel gets the same `{ film, events }` from one hook, `useFilm`, which loads the film and follows its
event stream.

**Today: the studio.**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PixiTween Director · Creative studio                     [film status]   │
├───────────────┬──────────────────────────────────────┬───────────────────┤
│ New film      │                                      │ Review            │
│ photo + brief │            Player                    │ findings · fixes  │
│ (or voice)    │   live PixiJS canvas of the film     │                   │
├───────────────┤   click a layer to select it         ├───────────────────┤
│ Storyboard    │                                      │ Chat  [badge]     │
│ scenes, shots │                                      │ "slower in        │
│               │                                      │  scene 2" · undo  │
├───────────────┴──────────────────────────────────────┼───────────────────┤
│ Generate: proposed clip, price, Approve              │ Export (MP4)      │
├──────────────────────────────────────────────────────┴───────────────────┤
│ Gallery: earlier films                                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Planned: the crew studio** (shown for crew films; `web/src/crew/CrewStudio.tsx`).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ PixiTween Director · Crew              💰 $0.41 of $1.50   [▶ Replay 2×] │
├────────────────┬─────────────────────────────────┬───────────────────────┤
│ LIVE STORYBOARD│                                 │ CREW                  │
│ ┌────────────┐ │                                 │ Showrunner · Wonder ⟳ │
│ │s1 hero  ✓  │ │           Player                │ Builder 1 · Spark  ✓  │
│ └────────────┘ │                                 │ Builder 2 · Spark  ⟳  │
│ ┌────────────┐ │                                 │ Builder 3 · Spark  ⟳  │
│ │s2 detail ⟳ │ │                                 │ Critic · blind     ⚑  │
│ └────────────┘ │                                 │ Continuity · rules ✓  │
│      ＋        │                                 │ Producer           💰 │
│ ┌────────────┐ │─────────────────────────────────├───────────────────────┤
│ │s5 sunset ✨│ │ TAKES  [A 6] [B 9 ★] [C 7] Pick │ DIRECTOR'S NOTES      │
│ └────────────┘ │                                 │ you: add a sunset…    │
│ ┌────────────┐ │                                 │ ▸ adding s5 after s2  │
│ │s3 pour  🎬 │ │                                 │ [🎙 hold to talk] [⏎] │
└────────────────┴─────────────────────────────────┴───────────────────────┘
```

The sketches show the panels, not exact sizes; the grid lives in the CSS. At 375 px the panels stack Player first.

```mermaid
flowchart TB
  App["App · ?film=id"]:::web --> Studio{"film.crew?"}:::web
  Studio -- no --> Director["Classic studio"]:::web
  Studio -- yes --> CrewStudio["CrewStudio"]:::plan

  Director --> useFilm["useFilm(filmId)<br/>GET film + SSE events"]:::web
  Director --> NewFilm & Storyboard & Player & Review & Chat & Generate["GenerateApproval"] & Export["ExportPanel"] & Gallery
  class NewFilm,Storyboard,Review,Chat,Generate,Export,Gallery web

  Player["Player"]:::web --> Engine["reacthub-pixitweenjs<br/>Pixi + GSAP"]:::ext
  Player --> Selection["selection/<br/>canvas pick · LayerList · overlay"]:::web
  Review --> AutoReview["review/useAutoReview"]:::web --> Capture["capture/<br/>seek · wait stable · measure text"]:::web
  Chat --> useChat["useChat"]:::web --> Badge["BackendBadge<br/>which model · Local toggle"]:::web
  Export --> ExportLib["export/<br/>record canvas · mix audio · MP4"]:::web

  CrewStudio --> useCrew["useCrew = crewReducer(events)"]:::plan
  CrewStudio --> CrewBoard["CrewBoard · JobChips"]:::plan & LiveSB["LiveStoryboard · SceneCards"]:::plan & Notes["DirectorNotes · PushToTalk"]:::plan & Takes["TakesPicker"]:::plan & Budget["BudgetMeter"]:::plan
  CrewStudio --> Bridge["useCaptureRequests"]:::plan --> Capture
  CrewStudio --> Player
  CrewStudio -.-> Replay["replay/ · clock · versions"]:::plan

  classDef web fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef ext fill:#f1f5f9,stroke:#64748b,color:#1e293b
  classDef plan fill:#ffffff,stroke:#7c3aed,color:#3b0764,stroke-dasharray:5 4
```

| Panel | Folder | What it does |
|---|---|---|
| New film | `web/src/panels/NewFilm.tsx` | Upload a product photo, type or record a brief, pick an aspect; `POST /api/films` |
| Storyboard | `web/src/panels/Storyboard.tsx` | Shows the director's plan as it arrives (`director.storyboard` event) |
| Player | `web/src/player/` | Plays the composition JSON with the engine; exposes a handle for capture and export |
| Selection | `web/src/selection/` | Click a layer on the canvas or in the layer list; the selection goes with the next chat message |
| Review | `web/src/panels/Review.tsx`, `web/src/review/` | Captures frames in the browser, posts them, shows findings and fixes |
| Chat | `web/src/panels/Chat.tsx` | Chat edits, undo/redo, and the badge naming the model that made each edit |
| Generate | `web/src/panels/GenerateApproval.tsx` | Shows a proposed video clip with its credit price; nothing is spent without Approve |
| Export | `web/src/panels/ExportPanel.tsx`, `web/src/export/` | Records the player canvas and encodes an MP4 in the browser |
| Gallery | `web/src/panels/Gallery.tsx` | Lists films; opening one sets `?film=` |
| *Crew studio (planned)* | `web/src/crew/` | Crew board, live storyboard, director's notes, takes, budget, push-to-talk, replay |

## 3. UI ↔ API

All routes live under `/api` and are registered from `server/http/routes.ts`; each feature owns one handler file in
`server/http/handlers/`. The passcode middleware (`server/http/auth.ts`, `DIRECTOR_PASSCODE`) guards the mutating
routes when a passcode is set. Rate limits and the film queue sit in the same middleware chain.

```mermaid
flowchart LR
  Req(["request"]):::web --> Pass["passcode"]:::srv --> Limits["rate limits<br/>films/hour · uploads · generate cap"]:::srv --> Log["logger"]:::srv --> Routes["routes.ts"]:::srv
  Routes --> H1["read-routes · sse"]:::srv & H2["handlers/films"]:::srv & H3["handlers/chat"]:::srv & H4["handlers/review"]:::srv & H5["handlers/generate"]:::srv & H6["handlers/local"]:::srv & H7["handlers/crew"]:::plan
  Routes --> Static["static.ts<br/>SPA fallback"]:::srv
  H2 --> Adm["admission queue<br/>≤ 2 in flight · 4 queued · 3 starts / 5 min"]:::srv

  classDef web fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef srv fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef plan fill:#ffffff,stroke:#7c3aed,color:#3b0764,stroke-dasharray:5 4
```

| Method | Path | Handler | Returns |
|---|---|---|---|
| GET | `/api/health` | `routes.ts` | Version, whether Meta is configured, ffmpeg, validator |
| GET | `/api/films` | `read-routes.ts` | Film list (Gallery) |
| POST | `/api/films` | `handlers/films.ts` | Multipart: photo + brief text or audio → `202 { filmId, queue }`, or `429` when the queue is full |
| GET | `/api/films/:id` | `read-routes.ts` | Film state: status, storyboard, composition, version |
| GET | `/api/films/:id/versions` | `read-routes.ts` | Version history |
| GET | `/api/films/:id/events` | `sse.ts` | **SSE** stream of film events (replays from the log, then live) |
| POST | `/api/films/:id/chat` | `handlers/chat.ts` | `{ message, selection?, local? }` → `202`; the edit runs in the background |
| POST | `/api/films/:id/undo` · `/redo` | `handlers/chat.ts` | `{ version }` |
| POST | `/api/films/:id/frames` | `handlers/review.ts` | Multipart frames + measured text boxes → starts the review |
| POST | `/api/films/:id/scenes/:sceneId/mode` | `handlers/generate.ts` | Switch a scene between motion and generated clip; proposes a clip with a price |
| POST | `/api/films/:id/scenes/:sceneId/approve` | `handlers/generate.ts` | Approval token → submits the paid clip |
| GET | `/api/assets/:id` | `read-routes.ts` | Image or clip bytes (unguessable 128-bit ids; Clippy also fetches stills here) |
| GET · PUT | `/api/local-mode` | `handlers/local.ts` | `{ local, reachable, … }`; turning it on checks Ollama and the Glimmer model first (`409` if missing) |
| GET | `/api/queue` · `/api/queue/:filmId` | film queue | Queue stats and a film's position (public) |
| *planned* | `/api/films/:id/crew` · `/log` · `/storyboard` · `/jobs/:jobId/cancel` · `/takes/:jobId/pick` · `/scenes/:sceneId/revert` · `/voice` | `handlers/crew.ts` | The crew board, the event log for replay, card edits, cancel, pick a take, revert a scene, spoken messages |

**Long work never blocks a request.** `POST /films`, `/chat` and `/frames` reply at once (`202`), and progress
arrives as events on the SSE stream. Every event is one of the types in `shared/events.ts`:

| Event | Meaning |
|---|---|
| `film.status` | `new → planning → building → reviewing → ready` (or `failed`) |
| `listener.transcript` | The spoken brief, transcribed |
| `director.storyboard` | The plan: scenes, shots, palette, title |
| `agent.turn` | One model turn: which backend, how long, how many tool calls |
| `tool.call` | One timeline edit (`version` set when it made a new version) |
| `art.asset` | A new scene image or cut-out layer |
| `review.finding` · `review.fix` | What the review found and what it changed |
| `generate.proposed` · `.progress` · `.done` | The paid-clip lifecycle |
| `cost` | Money spent, per model call |
| `error` | Where it failed and why |
| *planned* `crew.agent` · `job.update` · `showrunner.heard` · `showrunner.say` · `storyboard.revised` · `style.bible` · `take.ready` · `capture.request` · `budget` | The crew: who is doing what, every job transition, what the showrunner heard and said, storyboard revisions, takes, frame requests for the critic, spend against the cap |

```mermaid
stateDiagram-v2
  direction LR
  [*] --> new: POST /films
  new --> planning: admitted
  planning --> building: storyboard
  building --> reviewing: frames posted
  reviewing --> ready: fixes applied
  building --> ready: no review
  ready --> building: chat edit
  planning --> failed
  building --> failed
  failed --> [*]
  ready --> [*]
```

## 4. Sequences

### 4.1 Brief → playing film (today: one director, scenes in order)

```mermaid
sequenceDiagram
  autonumber
  actor U as 👤 User
  participant W as 🖥️ Browser
  participant S as ⚙️ Server
  participant Q as Admission
  participant D as Director
  participant M as 🦙 Meta API
  participant FS as 💾 DATA_DIR

  U->>W: product photo + brief (typed or spoken)
  W->>S: POST /api/films (multipart)
  opt spoken brief
    S->>M: Voice Transcribe
  end
  S->>FS: save photo, create film
  S->>Q: submit(filmId)
  S-->>W: 202 { filmId, queue }
  W->>S: GET /api/films/:id/events (SSE)
  Q->>D: runDirector(filmId)

  rect rgba(29, 78, 216, 0.08)
    Note over D,M: Plan
    D-->>W: film.status planning
    D->>M: Muse Spark · storyboard (strict JSON schema, with photo)
    D-->>W: director.storyboard
  end

  rect rgba(124, 58, 237, 0.08)
    Note over D,FS: Build, one scene after another (~18 s each)
    loop each scene
      D->>M: Muse Spark · parallel tool calls (layers, keyframes, camera, text)
      D->>M: Muse Image · scene plate
      D->>M: SAM 3.1 · product cut-out
      D->>FS: new version + assets
      D-->>W: agent.turn · tool.call · art.asset · cost
    end
  end

  D-->>W: film.status ready
  W->>W: Player plays the composition live
```

### 4.2 Self-review (the browser captures, the server judges)

The server can't run the engine, so the browser renders the frames and measures where the text actually landed.

```mermaid
sequenceDiagram
  autonumber
  participant W as 🖥️ Browser (Player + capture)
  participant S as ⚙️ Server
  participant R as Review loop
  participant M as 🦙 Muse Spark vision

  W->>W: seek sample times · wait until stable · grab frames · measure text boxes
  W->>S: POST /frames (phase "before")
  S->>R: runReview(frames, boxes)

  rect rgba(217, 119, 6, 0.08)
    Note over R: Measured rules first: off-frame text, text over product, too short, contrast
    R->>M: frames + rule facts (no guessing of time or geometry)
    M-->>R: visual findings with frame index
  end

  R-->>W: review.finding (each)
  R->>R: allowlisted fixes → new version
  R-->>W: review.fix · tool.call
  W->>W: re-capture
  W->>S: POST /frames (phase "after")
  S->>R: compare before / after · revert if worse
  R-->>W: film.status ready
```

### 4.3 Chat edit

```mermaid
sequenceDiagram
  autonumber
  actor U as 👤 User
  participant W as 🖥️ Browser
  participant S as ⚙️ Server
  participant E as Edit loop
  participant L as LLM router
  participant B as Spark · Spark Open · Glimmer

  U->>W: click a layer · "slower in scene 2"
  W->>S: POST /chat { message, selection, local? }
  S-->>W: 202 accepted (409 while a classic film builds)
  E->>L: pickBackend('edit', { local })
  L-->>E: Spark (default) · Spark Open (EDIT_BACKEND) · Glimmer (Local mode, or fallback on 402/5xx)
  E->>B: film summary + selection + tools
  B-->>E: tool calls
  E->>E: apply → new version
  E-->>W: agent.turn (backend, ms) · tool.call · cost
  W->>W: player updates · badge names the model
  U->>W: Undo
  W->>S: POST /undo → { version }
```

### 4.4 Generate mode (paid clip, approval-gated)

```mermaid
sequenceDiagram
  autonumber
  actor U as 👤 User
  participant W as 🖥️ Browser
  participant S as ⚙️ Server (generate/)
  participant C as Clippy MCP
  participant M as 🦙 SAM 3.1

  U->>W: switch scene to "generated clip"
  W->>S: POST /scenes/:sceneId/mode
  S->>C: get_credit_balance
  S-->>W: generate.proposed (reason, estCredits, token)

  rect rgba(220, 38, 38, 0.07)
    Note over U,S: Nothing is spent before this point
    U->>W: Approve
    W->>S: POST /scenes/:sceneId/approve { token }
    S->>S: check token · hourly cap
  end

  S->>C: animate_image (scene still from /api/assets/:id)
  loop until done
    S->>C: get_live_animate_status
    S-->>W: generate.progress
  end
  S->>S: download clip
  S->>M: track the product through the clip
  S->>S: swap the clip into the scene (or offer a retry)
  S-->>W: generate.done · tool.call
```

## 5. The Muse crew (planned)

The next build (S12). The single director becomes a crew: a **Muse Wonder showrunner** that you talk to the whole
time, and a job board that runs Spark workers in parallel. `CREW_ENABLED=false` keeps the director of §4.1.

### 5.1 Who does what

```mermaid
flowchart TB
  You(["👤 You<br/>voice · chat · storyboard cards"]):::web
  You == "heard at once · never busy" ==> Inbox

  subgraph Lead["Lead"]
    Inbox[("📥 Inbox<br/>user · job results · findings · budget")]:::store
    SR["🎬 Showrunner · Muse Wonder<br/>style bible · storyboard · dispatch · notes"]:::plan
    Inbox -- "wake (user: now · jobs: 1.5 s debounce)" --> SR
  end

  SR -- "board tools only" --> Board

  subgraph Floor["Crew floor"]
    Board["🗂️ Job board + scheduler<br/>≤ 4 at once · 1 writer per scene · you first · newer replaces older"]:::plan
    B1["🧱 Builder s1<br/>Muse Spark"]:::plan
    B2["🧱 Builder s2<br/>Muse Spark"]:::plan
    B3["🧱 Builder s5<br/>Muse Spark"]:::plan
    Crit["🔍 Critic · blind<br/>Spark vision"]:::plan
    Cont["📏 Continuity<br/>rules"]:::plan
    Takes["🎲 Takes A · B · C<br/>child films"]:::plan
    Local["🏠 Local hand<br/>Muse Glimmer"]:::plan
    Board --> B1 & B2 & B3 & Crit & Cont & Takes & Local
  end

  B1 & B2 & B3 --> Art["🎨 Muse Image · ✂️ SAM 3.1"]:::meta
  B1 & B2 & B3 -.-> P3D["🧊 3D product<br/>label from the photo · model3d layer"]:::plan
  B1 & B2 & B3 & Takes & Local --> Tools["existing tools → FilmStore.mutate"]:::srv
  Crit -- "capture.request" --> Browser["🖥️ Browser capture"]:::web
  Board -- "outcomes" --> Inbox
  Tools --> Log[("events.jsonl · versions")]:::store
  Log -- "SSE" --> Studio["Crew studio · replay"]:::web

  classDef web fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef srv fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef meta fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:2px
  classDef store fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef plan fill:#ffffff,stroke:#7c3aed,color:#3b0764,stroke-dasharray:5 4
```

### 5.2 Directing mid-build

```mermaid
sequenceDiagram
  autonumber
  actor U as 👤 User
  participant W as 🖥️ Crew studio
  participant I as 📥 Inbox
  participant SR as 🎬 Showrunner (Wonder)
  participant JB as 🗂️ Job board
  participant B as 🧱 Builders (Spark)
  participant C as 🔍 Critic

  rect rgba(29, 78, 216, 0.08)
    Note over SR,B: Planning turn
    SR->>JB: setStyleBible · reviseStoryboard(+4 scenes) · dispatch ×4
    par four scenes at once
      JB->>B: build s1
    and
      JB->>B: build s2
    and
      JB->>B: build s3
    and
      JB->>B: build s4
    end
  end

  U->>W: "add a sunset scene after the second one, warmer light"
  W->>I: POST /chat
  I-->>W: showrunner.heard (instant, no model call)
  I->>SR: wake now

  rect rgba(124, 58, 237, 0.08)
    Note over SR,JB: Re-plan while the crew keeps working
    SR-->>W: say "Adding s5 after s2, warming every scene"
    SR->>JB: reviseStoryboard(add s5 after s2) · dispatch build s5 · restyle s1, s2
    JB->>B: s2 builder cancelled → s2 rolled back to its snapshot
    JB->>B: build s5 · restyle s1 · restyle s2 (s3, s4 untouched)
  end

  B-->>JB: s1 done
  JB->>C: critique s1 (auto-chain)
  C->>W: capture.request
  W->>C: frames + text boxes
  C-->>I: s1 at 3.2 s: headline over the label
  I->>SR: wake (debounced)
  SR->>JB: dispatch fix s1
  SR->>JB: finish (only when nothing runs and continuity is clean)
```

### 5.3 A job's life

```mermaid
stateDiagram-v2
  direction LR
  [*] --> queued: dispatch · auto-chain · card edit
  queued --> running: slot free · scene free · budget ok
  queued --> superseded: newer job on the same scene
  queued --> cancelled: user · scene removed
  running --> awaiting_frames: critique asks the browser
  awaiting_frames --> done: frames arrive · or 90 s → rules only
  running --> done
  running --> failed: model error · budget · stall
  running --> superseded: user's newer job → scene rollback
  running --> cancelled: user cancel → scene rollback
  done --> [*]
  failed --> [*]
  superseded --> [*]
  cancelled --> [*]
```

## 6. Backend and infrastructure

```mermaid
flowchart TB
  subgraph Node["⚙️ Node 22 process · server/main.ts"]
    direction TB
    HTTP["http/ · Hono<br/>passcode → limits → logger → routes → SPA static"]:::srv
    Adm["admission.ts + film queue"]:::srv

    subgraph Agents["agents"]
      Dir["agent/director.ts<br/>storyboard → build scenes"]:::srv
      Edit["agent/edit-loop.ts"]:::srv
      Rev["review/loop.ts<br/>rules + vision + fixes"]:::srv
      Gen["generate/<br/>approval · jobs · poll · swap · clip check"]:::srv
      CrewMod["crew/<br/>showrunner · inbox · board · scheduler · workers"]:::plan
    end

    Tools["tools/ · typed tools<br/>authoring · art · edit · review · generate"]:::srv
    Auth["authoring/ · pure timeline edits<br/>scenes · layers · keyframes · camera"]:::srv
    Val["engine/ · light validator"]:::srv
    Router["llm/router.ts<br/>pickBackend · pickReviewer · fallback"]:::srv
    Clients["meta/ · Spark · Image · SAM · Transcribe<br/>replay fixtures in tests"]:::srv
    Bus["events/ · bus + log"]:::srv
    Ledger["ledger.ts · costs"]:::srv
    Stores["store/ · film-store (per-film lock, mutate) · asset-store"]:::srv
  end

  HTTP --> Adm --> Dir
  Adm -.-> CrewMod
  HTTP --> Edit & Rev & Gen
  Dir & Edit & Rev & CrewMod --> Tools --> Auth --> Val
  Dir & Edit & Rev & CrewMod --> Router --> Clients
  Tools --> Clients
  Agents --> Bus & Ledger & Stores
  Bus -- "SSE" --> HTTP

  Clients --> MetaAPI["🦙 api.meta.ai/v1"]:::meta
  Router -. "Local mode" .-> Ollama["🏠 Ollama · Muse Glimmer"]:::meta
  Router -. "spark-open" .-> BT["Baseten · inference.baseten.co/v1"]:::ext
  Gen --> CL["Clippy MCP server"]:::ext
  Gen --> FF["ffmpeg · clip checks"]:::ext
  Stores --> Disk[("💾 DATA_DIR")]:::store

  classDef srv fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef meta fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:2px
  classDef ext fill:#f1f5f9,stroke:#64748b,color:#1e293b
  classDef store fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef plan fill:#ffffff,stroke:#7c3aed,color:#3b0764,stroke-dasharray:5 4
```

### Storage: plain files under `DATA_DIR` (default `./data`)

```
data/
├── films/<filmId>/
│   ├── film.json         current state: status, storyboard, head version, redo stack
│   ├── versions/<n>.json one composition per version (undo/redo moves the head)
│   ├── events.jsonl      every event, replayed to late SSE subscribers (and, planned, to the gallery replay)
│   ├── ledger.jsonl      every model call and its cost
│   └── crew/             planned: board.json (jobs) · snapshots/<jobId>.json (scene rollbacks)
└── assets/
    ├── <assetId>.json    metadata (mime, size, role)
    └── <assetId>.<ext>   bytes: product photo, scene images, cut-outs, clips
```

No database. Writes are atomic per file and serialised per film. Because state lives on disk, the server must run as
**one long-lived process with a persistent volume**: it can't run on serverless functions as it is.

### Outside services

| Service | Used for | Key | When |
|---|---|---|---|
| Meta API (`api.meta.ai/v1`) | Muse Spark (plan, build, edit, review), Muse Image, SAM 3.1, Transcribe; *planned:* Muse Wonder (showrunner) | `META_API_KEY` | Every film |
| Ollama (local) | Muse Glimmer for Local mode, and fallback when Meta returns 402/5xx | none | When Local mode is on, or as fallback |
| Baseten (`inference.baseten.co/v1`) | Muse Spark Open for chat edits | `BASETEN_API_KEY` | Only with `EDIT_BACKEND=spark-open` |
| Clippy MCP | One generated video clip per approved scene | `CLIPPY_TOKEN`, `CLIPPY_MCP_URL` | Only after Approve |
| npm `reacthub-pixitweenjs` | The player engine, in the browser | none | Always |

### Limits and safety

- **Admission:** at most `FILMS_IN_FLIGHT_MAX` films run at once, `FILMS_QUEUE_MAX` wait, and at most
  `FILMS_STARTS_PER_WINDOW` start per `FILMS_WINDOW_SEC`; beyond that `POST /films` returns `429` with `Retry-After`.
  Planned for the crew: 2 starts per window (a crew film uses about 60 of Meta's 150 requests per window).
- **Spend:** every model call is written to the ledger and sent as a `cost` event. Paid clips need an approval token
  and are capped per hour (`GENERATE_MAX_PER_HOUR`). Planned: a per-film crew budget with warn at 80 % and stop at 100 %.
- **Tests never call real services:** the Meta clients replay recorded fixtures, and Clippy and the LLM have fakes.
  Real calls happen only in `npm run live -- <step> --yes`, run by the owner.

### Running it

| | Command | What runs |
|---|---|---|
| Dev | `npm run dev` | `tsx watch server/main.ts` (port 8787) + Vite dev server |
| Prod | `npm run build`, then `node` on `server/main.ts` via tsx | Hono serves the API and the built SPA from one port |
| Checks | `npm test` · `npm run e2e` · `npm run typecheck` · `npm run check:bundle` | Vitest, Playwright, tsc, key-leak guard |

```mermaid
flowchart LR
  User(["👤 Judge / user"]):::web == "HTTPS" ==> Edge["Fly.io edge<br/>fly-client-ip"]:::ext
  subgraph Host["Fly machine · app pixitween-director · iad"]
    App["Node 22<br/>API + SPA · one port"]:::srv --- Vol[("Fly volume<br/>/data = DATA_DIR")]:::store
  end
  Edge ==> App
  App --> Meta["🦙 Meta API"]:::meta
  App -.-> Base["Baseten"]:::ext
  App -.-> Clip["Clippy MCP"]:::ext

  classDef web fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef srv fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef meta fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:2px
  classDef ext fill:#f1f5f9,stroke:#64748b,color:#1e293b
  classDef store fill:#fef3c7,stroke:#d97706,color:#78350f
```

## 7. Not built yet

| Piece | State |
|---|---|
| Deployment (S8b) | `Dockerfile` and `fly.toml` (volume at `/data`) are written; not deployed yet. Local mode is not available on the host (no Ollama there). |
| Engine multi-scene playback | Fixed in `reacthub-pixitweenjs@0.3.0-alpha.4`, confirmed on `0.3.0-alpha.5` (2026-10-30): playing through a scene boundary and seeking to a scene with a clip layer both work (`ENGINE-NEEDS.md`). |
| Frame review on Spark Open | Review always uses Meta Spark (or Glimmer in Local mode). |
| Parallel scene building | Scenes are built one at a time; the crew's scheduler replaces this. |
| MCP server for the director (S11) | Planned; the boot-hook slot in `server/boot.ts` is reserved for it. |
| **3D product shots (S13)** | Engine side done; app side planned. The engine now has a `model3d` layer (shipped in `0.3.0-alpha.5`): one shared Three.js renderer drawing into Pixi textures, frame-driven, inside scene precomps, so capture and export see it. The Director adds `server/product3d/` (label unwrap from the photo, box faces, extruded contours), the tools `placeProduct3D` / `turnProduct` / `lightProduct`, and the three-way Motion / 3D / Generate decision. Behind `PRODUCT_3D`. |
| **The Muse crew (S12)** | Planned, the next build (§5). A Muse Wonder showrunner (`server/crew/showrunner.ts`) reacts to an inbox and acts only through board tools; a per-film job board and scheduler (`server/crew/scheduler.ts`) run Spark builders, a blind critic, continuity checks and takes (child films); chat to a crew film never returns 409; the web app gets a crew studio (`web/src/crew/`) and a replay of any film's event log. `CREW_ENABLED=false` keeps today's director. |
