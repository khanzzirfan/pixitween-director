# Demo practice pack

Everything needed to rehearse and record the 3-minute demo video, plus a live walkthrough for judges or a call. Written for the owner to practise from. It adds to [demo-script.md](demo-script.md) (the catalog-led script); where the two differ, this pack is the newer plan because it also shows the cinematic cut.

Product name: **MuseReels**, the same in the narration, the title card and the form (the README and [deploy/04](deploy/04-musereels-name-and-ci-spec.md) use it).

## Deadline

Submissions close **Wed 4 Nov, 9:00 PM ET**.

| Zone | Time |
|------|------|
| ET (EST, UTC-5; US clocks changed on 1 Nov) | Wed 4 Nov, 9:00 PM |
| UTC | Thu 5 Nov, 02:00 |
| Sydney / Melbourne (AEDT, UTC+11) | **Thu 5 Nov, 1:00 PM** |
| Brisbane (AEST, UTC+10, no daylight saving) | Thu 5 Nov, 12:00 noon |

[04-submission-checklist.md](hackathon/04-submission-checklist.md) aims to submit by Wed 4 Nov, 12:00 ET, which is Thu 5 Nov, 4:00 AM Sydney. That is the middle of your night, so the plan below submits earlier, on Wed 4 Nov in Sydney daytime.

## The one-sentence story

*Drop in a photo and say what you want; a crew of Muse agents builds a checked, editable video ad while you keep directing, and the same crew turns a whole product CSV into one ad per product.*

Three things a judge must remember: **it is a crew** (parallel builders you can talk to), **it is checked** (a blind critic and measured rules, nothing marks its own work), **it is editable** (layers as JSON, so a price change costs nothing).

## Plan for the 3:00 video

| Time | Beat | What is on screen |
|------|------|-------------------|
| 0:00–0:15 | The problem | a store grid with empty video slots, then the studio |
| 0:15–0:45 | Photo and spoken brief; the crew plans and four builders start | chat, Plan tab, Crew lanes (label "4×" if sped up) |
| 0:45–1:05 | Interrupt mid-build: "add a sunset scene" | Crew lanes: one new job only |
| 1:05–1:30 | The check: critic and rules flag something real, a fix job fires | Review tab, Crew lanes |
| 1:30–1:55 | The finished film plays, with the cinematic cut on a round product | player |
| 1:55–2:25 | The catalog: CSV dropped, the wall fills, one price edit, cost unchanged | catalog wall |
| 2:25–2:45 | Measured numbers | title card |
| 2:45–3:00 | Watch it being made (2 s), name, live URL, repo | replay, title card |

If time is short, cut the catalog beat to 20 s before cutting the check beat. The check is what separates this from a video generator.

## Narration (about 400 words, calm pace)

Read it aloud with a timer. At 140 words a minute it fills 2:50.

**0:00** Every product in a shop needs a video ad. Almost none have one, because a freelancer charges per video, and every price change means another invoice.

**0:15** MuseReels is a crew of Muse agents. I drop in one photo and say the brief. Muse Voice Transcribe turns my voice into text. Muse Wonder, the showrunner, writes the storyboard and a style bible. Four Muse Spark builders then work on different scenes at the same time. Muse Image paints the set, and SAM 3.1 cuts the product out as its own layer.

**0:45** While they build, I change my mind: add a sunset scene. The showrunner changes only the scenes it touches. The other builders keep going.

**1:05** Nobody marks their own work. A critic that never saw the storyboard looks at captured frames, and measured rules check contrast, safe area and text over the product. Here it found a fault, and a fix job goes straight back to a builder.

**1:30** The film is layers as JSON, not a video file. For a round product, the cinematic cut gives it a real camera, ingredient splashes and an animated price card. Before it replaces the flat film, a frame review has to agree it looks better. If it does not, the flat film stays.

**1:55** Now the whole catalog. I drop in a product CSV. Each product gets its own ad, and the title and price come straight from the feed, so a price is never invented. Because it is layers, I change twenty-four dollars to nineteen, only that clip rebuilds, and the cost counter does not move.

**2:25** *[read the measured numbers from your last real run, see "Numbers to fill in"]*

**2:45** Every film has a replay of how the crew made it, at no cost. MuseReels: your whole catalog, as ads.

## Beat-by-beat: what to click

Use this when rehearsing. Browser at 100% zoom, 1920×1080, Chrome.

1. **Open** http://localhost:5173. Left rail: Gallery. Studio tabs: Brief → Plan → Build → Review → Export.
2. **Brief (0:15).** Drop one round-product photo, press 🎙, say the brief, press ■, press **Send now**. Say something like: *"A ten-second vertical ad for this can. Bold, clean, end on the price, twenty-nine dollars."* Pick 9:16 first.
3. **Plan (0:30).** Open the **Plan** tab: each scene with copy, camera move and duration.
4. **Crew (0:35).** Open **Crew**, **Lanes**. Point at the four builders and the job costs in cents.
5. **Interrupt (0:45).** In **Talk to the showrunner**, type or hold Space and say: *"Add a sunset scene after the second one."* Show that only one new job appears.
6. **Review (1:05).** Open **Review**: findings tied to a scene and a time, each with its measured number. Only show a fault the run really produced. Never stage one.
7. **Player (1:30).** Play the finished film. The cinematic cut applies on its own at finish to a round product; any other product keeps the flat finish. Say which one you are showing.
8. **Catalog (1:55).** **New film**, drop `fixtures/catalog/feed-summer-surf.csv`, **Make film**. Two films build at a time, in feed order, so start this early or use a wall you already filled.
9. **Price edit (2:10).** Change $24 → $19 on one row. Only that clip rebuilds; the cost counter stays.
10. **Replay (2:45).** Gallery → any crew film → **Watch it being made**, 8×.

## Before every rehearsal

- [ ] `npm run dev`, then `curl -s localhost:8787/api/health` shows `metaConfigured`, `ffmpeg` true.
- [ ] **Restart the server** after the latest changes. The cinematic review gate and the new cut options are uncommitted and not live until a restart.
- [ ] A fresh Muse key with credit left (a film costs about $0.15–$1.00; the per-film budget stops at $1.50).
- [ ] No key, passcode or private path on screen. Hide the terminal and `.env`.
- [ ] Close notification pop-ups and unrelated tabs.
- [ ] Microphone checked once in Chrome.

## Fallbacks

| What goes wrong | Do this |
|-----------------|---------|
| Muse API slow or out of credit | Play a finished crew film from the Gallery and use **Watch it being made**; the replay calls no model |
| Voice brief fails | Type the brief; say "spoken or typed" in the narration |
| No key at all | `npx tsx scripts/demo-film.ts load data-fake`, then `npm run dev:fake` (this uses ports 8790 and 5180, as the README says). The gallery then holds *Morning Ritual* with its replay |
| Cinematic cut falls back to the flat film | Say so: the gate kept the flat film because the review did not approve the cut. That is the feature working |
| A film is still building when you need it | Cut to a pre-recorded 4× clip and label it "4×" |

## Practice schedule (Sydney time)

| When | What |
|------|------|
| Tue 3 Nov, evening | Read the narration aloud twice with a timer. Cut words until it fits 2:50 |
| Tue 3 Nov, night | One full dry run of the click path with the real app, no recording |
| Wed 4 Nov, morning | Record the live parts (brief, interrupt, review, catalog) as separate clips; keep the best take of each |
| Wed 4 Nov, midday | Record the voice-over to the timed script, edit, add labels |
| Wed 4 Nov, afternoon | Upload as unlisted, open it logged out, fill in the form |
| Wed 4 Nov, by 7 PM | Submit |

Wed 7 PM Sydney is Wed 3:00 AM ET, 18 hours before the cutoff. The hard deadline is Thu 1 PM Sydney; treat that slack as a buffer for a failed upload, not as working time.

## On-screen labels

- Built during the Meta Global AI Developer Hackathon, 27 Oct – 4 Nov 2026
- Engine: our own Three.js engine, built in this hackathon
- Clips checked from their JSON before any render
- "4×" or "8×" whenever footage is sped up

## Numbers to fill in

Read these from your last real run, not from this page. None are recorded here, because none were measured in this pack.

- products in the catalog run and the wall time
- cost per product (`npx tsx scripts/cost-per-film.ts`)
- jobs, seconds and cost of the crew film (`npx tsx scripts/crew-report.ts`)
- how many rows the verifier fixed

The submission answers table already marks "Live cost of a crew film" as *still to be measured*. Do that run before recording, or leave the claim out.

## Likely judge questions

- **What did you build during the hackathon?** The whole repo, including our own GSAP and Three.js engine; the README lists pre-existing dependencies.
- **Why layers instead of generated video?** Edits are exact and free, every version undoes, and title and price always match the feed.
- **What stops it spending forever?** A per-film budget (default $1.50) and every model call logged as a cost event.
- **What does the critic see?** Captured frames only, never the storyboard, so it cannot mark its own work.
- **What if the cinematic cut looks worse?** A frame review compares it before it replaces the flat film, and the flat film stays if it does not pass.
- **Which Meta models?** Muse Wonder (showrunner), Muse Spark 1.3 (storyboard, builders, review), Muse Image (sets), SAM 3.1 (cut-outs), Muse Voice Transcribe (voice).

## What is not verified

- The cinematic review gate has unit tests but has **not** run against a live Muse call. Run one real film after the server restart before you rely on it in the video.
- The newer cut shaders, per-shot direction, reflections and spot lights are tested and rendered in stills, but not yet in a full live film or an MP4 export.
