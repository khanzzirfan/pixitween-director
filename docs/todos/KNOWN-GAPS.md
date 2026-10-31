# Todo: known gaps (not on the demo path)

- [ ] Fix loops can exceed a live script's timeout; the script then writes nothing (spike run 3 needed a manual recovery from its data dir).
- [ ] The critic and `finish` are not gated on the finished look; only on rules.
- [ ] Playwright cartoon e2e (`e2e/cartoon.spec.ts`) is unrun.
- [ ] Cartoon US-009 cast cards UI not built.
- [ ] 10 known failing tests in the suite (same set on every run); `server/tools/product3d.test.ts` flakes once in a while.
- [ ] Nothing from the pivot is committed yet (about 35 modified and untracked files).
- [ ] Cartoon files owned by the other session (`server/cartoon/props.ts`, `scripts/make-props.mjs`, `web/src/dev/stage-check.tsx`) need merging with its branch.
