# Studio UI redesign: one compact page (spec)

Status: draft for implementation. Written against `integration` at `ba774c9` (S12d). No code changed by this document.

## 1. Problem

Today the app is a long scrolling page of equal cards (new film, storyboard, player, review, chat, generate, export, gallery). In the classic flow each card is half the screen wide and tall; the player is buried mid-page, the director's desk is far from the player, and the Generate panel repeats a three-line block per scene. The crew studio (S12d) is better but is still a three-column page that scrolls, with a phone frame that eats about 400 px of height.

What is wrong, concretely:

- The player is the product, yet it is not always visible. Editing a scene and seeing the result means scrolling.
- Everything is always open, so nothing is prioritised. There is no sense of "where am I in the process".
- Panels are verbose: each scene is a 5-line card ("A still is enough for this shot.", "Real video costs about 25 credits and needs your approval." four times).
- Two different shells (classic grid, crew studio) share almost nothing.
- Nothing is resizable; nothing remembers the layout.

## 2. Goal

A single full-viewport page, no page scroll on desktop, built from four things:

1. **Left icon rail** that switches the left panel (the "handrail").
2. **Stepper** in the header showing and driving the film's progress.
3. **Resizable panels** (left tool panel, centre stage, right chat), sizes remembered.
4. **Compact content**: denser cards, filmstrip of scenes under the player, details on demand.

The same shell serves classic films, crew films and "no film yet".

## 3. Layout (desktop, 900 px and up)

```
+--------------------------------------------------------------------------------+
| o PixiTween Director  Film title   (1 Brief)-(2 Plan)-(3 Build)-(4 Review)-(5 Export)   $0.37 [ready] [theme] [chat] |
+----+-----------------------+----------------------------------+-----------------+
| N  | LEFT PANEL            |            STAGE                 | RIGHT PANEL     |
| P  | (one tool at a time)  |   player, fitted to height       | chat / director |
| C  |                       |   transport bar                  | thread          |
| R  | resizable 18-45%      +----------------------------------+ resizable       |
| G  |                       | filmstrip: s1 s2 s3 s4 [+]       | collapsible     |
| E  |                       | (status ring, duration, mode)    |                 |
| L  |                       |                                  |                 |
+----+-----------------------+----------------------------------+-----------------+
```

- Root is `height: 100dvh; overflow: hidden`. Each panel scrolls on its own.
- **Rail tabs** (icon + 10 px label): New, Plan, Crew (crew films only), Review, Generate, Export, Gallery. Clicking the active tab collapses the left panel (like an IDE); clicking another opens it. Badge on a tab for counts (scenes, running jobs, review findings).
- **Header stepper**: Brief, Plan, Build, Review, Export. Derived from film status (`new`/none → 1, `planning` → 2, `building` → 3, `reviewing` → 4, `ready` → 5). Done steps show a tick. Each step is a button that opens the matching tab. Replaces the "01 / 03" pill and the big status pills.
- **Right panel**: classic films show the director chat (edit, undo, redo); crew films show the crew chat thread. Collapsible from a header button. No phone frame in the studio (keep `PhoneFrame` only for the intake on narrow screens if wanted; default off).
- **Stage**: player fitted to the available height (`max-height: calc(100dvh - header - strip - controls)`, canvas `width:auto; max-width:100%`, aspect kept for 16:9, 9:16 and 1:1). Filmstrip below: one chip per scene (id, 1-line intent, seconds, mode dot, status ring for crew). Click selects the scene and seeks the player to it; "+" adds a scene in crew mode.
- **Persistence**: panel sizes via `autoSaveId`; active tab and theme in `localStorage` (always inside try/catch).

## 4. Layout (below 900 px)

No resizable panels. Column: stage on top (player + filmstrip), active tab content below (page scrolls), tab bar fixed at the bottom with the chat as one more tab. Must not scroll sideways at 375 px (existing S12d requirement stays).

## 5. Library

Use `react-resizable-panels@3.0.6`, the version `app-eyecast-app-frontend` already uses (`PanelGroup`, `Panel`, `PanelResizeHandle`, `autoSaveId`, `collapsible`, imperative `collapse()/expand()`). Add to root `package.json` dependencies. Do not copy eyecast source files; the handle is a few lines of CSS (a 6 px hit area with a 2 px accent line on hover and drag, via `[data-resize-handle-state]`).

Icons are inline SVG paths (no icon package). Colour and spacing come from the existing tokens in `web/src/styles/theme.css`; no new palette. Both themes must work, plus a header theme toggle that sets `data-theme` on `<html>` and remembers it.

## 6. Components and files

New, in `web/src/shell/`:

| File | Responsibility |
| --- | --- |
| `StudioShell.tsx` | Header (brand, title, stepper, right slot, status, theme, chat toggle), rail, `PanelGroup`, narrow-screen fallback. Props: `title, status, steps, step, tabs[{id,label,icon,badge,content}], defaultTab, stage, strip, side, sideTitle, headerRight, testId`. All tab contents stay mounted and inactive ones get `hidden`, so panel state (auto review, forms) survives tab switches and every `data-testid="slot-*"` still exists. |
| `Icon.tsx` | The inline SVG set (plus, list, users, eye, bolt, download, grid, chat, sun, moon). |
| `Filmstrip.tsx` | The scene strip under the player. Reads the storyboard (crew: `crew.storyboard ?? film.storyboard`). |
| `shell.css` | All shell styles. Overrides the old card chrome inside panes: `.sh-pane .slot {border:0; border-radius:0; box-shadow:none; padding:12px; background:transparent}`. |

Changed:

- `web/src/App.tsx`: `Director` builds one `StudioShell` for all three cases. Classic tabs: New, Plan (`Storyboard`), Review, Generate, Export, Gallery; side = `Chat`; stage = `Player`. Crew: `CrewStudio` supplies Plan (`LiveStoryboard`), Crew (`CrewBoard` + `TakesPicker`), plus Export and Gallery passed in as `extraTabs`; side = `ChatThread`; header right = `BudgetMeter`. No film: New tab open, stage shows the empty player.
- `web/src/crew/CrewStudio.tsx`: return `StudioShell` instead of the grid; keep `data-testid="crew-studio"`, `useCrew`, capture bridge, poster and play logic. `play()` must stop scrolling and just seek and play.
- `web/src/crew/crew.css`: add `.sh` to the selectors that define `--c-working`, `--c-thinking` etc. (they are scoped to `.studio` today); remove the `.studio-grid`, `.col-*`, `.studio section` card rules once unused; `.sh-side .notes {max-height:none; flex:1}`.
- `web/src/panels/NewFilm.tsx`: drop the `PhoneView` wrapper around `ChatIntake`; the intake fills the left panel. Compact classic form: product photo and name side by side, 3-row brief, format as a segmented control, one primary button; the preview thumbnail max 120 px.
- `web/src/panels/Storyboard.tsx`: compact scene rows. One line: id, intent, seconds, mode pill; one muted line: camera and on-screen text; `modeReason` moves to a `title` tooltip; tool ticker and cost move into a collapsed `<details>` or the header cost figure.
- `web/src/panels/GenerateApproval.tsx`: one row per scene (id, Motion/Generate segmented control, credit estimate on hover); the "costs about 25 credits and needs your approval" sentence shown once, only when a scene is set to Generate.
- `web/src/panels/Review.tsx` / `ReviewView.tsx`: result list as a compact table (scene, verdict, finding), Re-run as an icon button. Fix the visible bug in the old screenshots: `edited by undefined · 0 s` in the director's desk must not render when there is no editor name.
- `web/src/panels/Gallery.tsx`: becomes a left-panel list (2-column thumbnail grid); the card title is the film title, not the product, so the four identical "Morning Ritual" cards are distinguishable (add created date).
- `web/src/player/Player.tsx`: no behavioural change; only CSS fit rules for the stage.

Do not touch `shared/`, `server/` or the engine. No contract changes.

## 7. Richer, still compact (ordered by value; cut from the bottom)

1. Filmstrip with status rings and click-to-seek (above).
2. Rail badges: scene count, running jobs, review findings.
3. Collapsible panels with remembered sizes; double-click a handle resets it.
4. Keyboard: `Space` play/pause (ignored in text fields, as push-to-talk already is), `1`-`7` switch rail tabs, `[` and `]` toggle left and right panels, `?` shows a shortcut sheet.
5. Header cost chip replacing the "Cost $0.3760" line; opens the crew board on click.
6. Stage overlay on hover: scene id and time.
7. Activity feed (last 20 tool calls) as a small popover from the header instead of a permanent list.

## 8. Constraints from existing tests

These selectors must keep working (or the tests are updated in the same change and listed in the PR):

- `web/src/App.test.tsx`: eight `slot-*` test ids present with no film (`new-film, storyboard, player, review, chat, generate, export, gallery`); `film-status` text equals the status; `player-empty`; `backend-badge`.
- `e2e/crew.spec.ts`: role `log` named "Conversation"; button "Send"; `crew-studio`; `.lane-builder .state-pill.st-working`; tabs "Map" and "Lanes"; `[data-node^="builder:"].is-lit`; `[data-scene]` elements in order; `.bubble.you`, `.bubble.crew`, `.bubble.k-ready`; `slot-player` with a "Play" button and a canvas.
- `e2e/director-flow.spec.ts`: textbox "Brief", button "Create my storyboard →", "Undo", "Redo", "Send request →", layer buttons `/s1:headline/`.
- Tests render in jsdom without `matchMedia` and `ResizeObserver`: `useWide` must default to wide, and `web/src/test-setup.ts` may need a `ResizeObserver` stub for the panel library.
- Content that must be visible for Playwright (`toBeVisible`) lives in the active tab; the e2e flows must open the needed tab first (add a `data-testid="rail-<id>"` and click it where needed), or default the tab so the flow needs no click. Preferred: default tab is Plan for crew films and New before a film exists.
- Left panel collapsed means its content is not visible; e2e must not assume it is open after the test clicks the active tab.

## 9. Work order (each step lands green on its own)

1. **Shell and tokens** (S-UI-1): `StudioShell`, `Icon`, `shell.css`, dependency, `useWide`, theme toggle, unit tests (tab switch keeps panes mounted, collapse toggle, narrow fallback, theme persistence). Wire the classic `Director` and the empty state only.
2. **Crew into the shell** (S-UI-2): `CrewStudio` on `StudioShell`, `extraTabs`, remove the phone frame from the studio, CSS clean-up, update `e2e/crew.spec.ts`. Depends on 1.
3. **Panel compaction** (S-UI-3): `Storyboard`, `GenerateApproval`, `Review`, `NewFilm`, `Gallery` as in section 6. Independent of 2; depends on 1. Can be split per panel.
4. **Filmstrip and stage fit** (S-UI-4): `Filmstrip`, player fit CSS, click-to-seek, status rings. Depends on 1.
5. **Richer extras** (S-UI-5): items 2 to 7 of section 7. Depends on 2 and 4.

Steps 2, 3 and 4 touch different files and can run in parallel after step 1. Step 3 and step 2 both touch `crew.css` only if step 3 avoids it (it does not need to).

## 10. Acceptance

- At 1440x900 and 1920x1080 the page does not scroll; the player, filmstrip, one left panel and the chat are visible together.
- Dragging a handle resizes, a reload restores sizes, clicking the active rail tab collapses the left panel.
- Stepper highlights the right step for each film status and its steps open the matching tab.
- At 375 px: stage first, no sideways scroll, tab bar reachable.
- Light and dark both readable; reduced-motion respected.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e` and `npm run e2e:crew` pass. Check by running the fake crew (`DIRECTOR_FAKE=1 DIRECTOR_FAKE_DELAY_MS=1200 npm run dev:server` and `npm run dev:web`) and screenshotting both films at 1440 px and 375 px.
- No paid calls in tests or in verification.

## 11. Out of scope

Server, shared contracts, the engine, new crew features, S12f (crew finish) and S12e (replay). Changes to review or generate logic: layout only.
