# The crew: how PixiTween Director makes a film with agents

You talk, a crew of Muse agents builds. One lead agent plans and answers you; several builders work on different scenes at the same moment; a critic who has never seen the plan checks the pictures. Everything the crew does is written to an event log, so any finished film can be played back as a show.

Turn the crew off with `CREW_ENABLED=false` and the app falls back to the single sequential director.

## The crew

| Who | Model | What it does |
|-----|-------|--------------|
| Showrunner | Muse Wonder (`SHOWRUNNER_MODEL`) | Holds the whole film in mind. Plans the storyboard, sets the style bible, hands out jobs, answers you. The only agent that talks to you. It never edits the timeline itself. |
| Scene builders | Muse Spark | One scene each, in parallel, using the same authoring tools as the single director, scoped to their scene. |
| Art department | Muse Image, SAM | Background plates and product cut-outs, called by the builders. |
| Critic | Muse Spark vision, blind | Looks at captured frames of a finished scene. See [Blind critic](#blind-critic). |
| Continuity | Code | Cross-scene checks: product size, palette, type, text over the product, off-frame. |
| Producer | Code | The film budget and the request window. |
| Listener | Muse Voice Transcribe | Push-to-talk: speak to the showrunner while the crew works. |

The showrunner acts only through board tools: revise the storyboard, set the style bible, dispatch or cancel a job, pick a take, say something, ask you a question. The timeline is only ever changed by a worker's job.

## How jobs run

- The showrunner wakes when something lands in its **inbox**: your message, a job finishing, a critic finding, a budget warning. Messages that arrive while it thinks are batched into its next turn (`CREW_INBOX_DEBOUNCE_MS`).
- Every unit of work is a **job** on a per-film board: `build-scene`, `rebuild-scene`, `restyle-scene`, `edit`, `fix`, `take`, `critique`, `continuity`, `revert`. A job has an origin (you, the showrunner, or automatic), a status and its own cost.
- At most `CREW_MAX_WORKERS` (default 4) jobs run at once, and at most one writing job per scene. A newer job for a scene supersedes the queued one and cancels the running one; the cancelled job's half-done scene is restored from a snapshot, so other scenes are never touched.
- You can edit the storyboard yourself while it builds: add, remove, move or rewrite a scene. That edit applies at once with no model in the loop, and only the scene you changed is rebuilt.
- The film has a budget (`CREW_FILM_BUDGET_USD`). At the warning level the showrunner is told to prefer cheap edits over rebuilds and no takes; at the stop level new jobs are refused.
- The studio draws the board, the crew map and the storyboard from the same event stream, so the live view and a replay are the same code.

## Blind critic

The critic judges what is on screen, not what was intended. It is given frames and never the storyboard, so it cannot excuse a mistake with the plan.

1. The server asks the browser for frames of a scene at 20 %, 50 % and 80 % of the scene's own length.
2. The page that is playing the film captures them and posts them back.
3. The critic reports what it sees and at which second. Rules in code check the same frames for overlap, off-frame text and size drift.

Without a browser the critic falls back to the rules alone and says so. Findings go to the showrunner's inbox, which decides whether a fix job is worth it; a scene gets at most two showrunner fixes.

## Takes

Ask for "three takes of the opener" and three builders each make their own version of that scene, in child films, in parallel. The critic scores each one, the studio shows them side by side with the best one marked, and one click puts the take you like into the film. Picking splices only that scene into the parent film and has it checked again.

## Replay

Every film keeps an event log (`/api/films/<id>/log`). The **Watch it being made** button in the gallery opens the film with `?replay=1` and plays that log back: the board lanes change, the storyboard grows, the picture follows each saved version, and the showrunner's messages appear as they were said.

- Speeds 1×, 2×, 4×, 8×. Pauses longer than two seconds are squeezed to two seconds before the speed applies, so a long build stays watchable.
- A scrubber moves to any point. Moving back is exact: the state is always a fold of the events up to that point.
- A replay is read-only. It reads the film, its versions and its log, and nothing else: no chat, no push-to-talk, no Cancel or Pick buttons, no model call, no cost, no passcode.
- To try it with no network: `npx tsx scripts/demo-film.ts load`, start the app and open the gallery. The committed demo film was recorded with the offline fake crew (`DIRECTOR_FAKE=1`).

## Measured

`npx tsx scripts/crew-report.ts <film-id or events.jsonl>` prints these numbers from a log (add `--json` for a machine-readable copy).

Offline fake-crew run (the committed demo film; fake workers and priced as if real, so the cost line is not a measurement of any live run):

| Number | Value |
|--------|-------|
| Peak parallel workers | 4 |
| Jobs | 21, all done (5 builds, 1 fix, 3 takes, 6 critiques, 6 continuity checks) |
| Storyboard revisions | 3 (2 by the showrunner, 1 by the user) |
| Takes | 3 |

Live numbers:

| Number | Value |
|--------|-------|
| Showrunner tool calls valid, 5 parallel calls in one turn (probe, 30 Oct 2026) | 5 of 5 |
| Showrunner turn time and cost per turn (same probe) | about 22 s and about $0.06 |
| Wall time to a playable film on a live run | to be measured |
| Cost per film on a live run | to be measured |
| Sequential director against the crew, same brief | to be measured |
