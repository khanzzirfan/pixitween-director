# Next steps (owner)

Status on Wed 28 Oct 2026. The specs are in `docs/hackathon/` and the Ralph PRDs are in `ralph/`. The full plan lives in
the private monorepo at `specs/hackathon/meta/`.

## Done
- [x] Meta billing: card added, $150 free credits active.
- [x] Engine `reacthub-pixitweenjs@0.3.0-alpha.3` published; `ralph/ENGINE_SPEC` points at it.
- [x] Repo created (Apache-2.0) and scaffolded by `bootstrap-repo.sh`. Nothing is committed yet.

## 1. Check the engine is installable (2 min)
```bash
npm view reacthub-pixitweenjs dist-tags        # expect latest: '0.3.0-alpha.3'
```
If it still says `0.2.109-alpha.7` after ~15 min, the publish didn't land: rerun `npm publish` in the engine checkout.
If you'd rather keep `latest` on the old stable, do this (optional; the repo pins the exact version, so this has no effect on the build):
```bash
npm dist-tag add reacthub-pixitweenjs@0.3.0-alpha.3 alpha
npm dist-tag add reacthub-pixitweenjs@0.2.109-alpha.7 latest
```
If it's still not visible and you want to start anyway: `echo 'file:../reacthub-pixitweenjs' > ralph/ENGINE_SPEC`.

## 2. First commit (5 min)
```bash
brew install gitleaks && gitleaks detect --no-git --source .
python3 ralph/build_prds.py --check            # expect: OK (check only)
git add -A && git commit -m "chore: scaffold from hackathon specs" && git push
```

## 3. Ralph wave 1: S2 skeleton (38 stories, today)
```bash
git worktree add ../pixitween-s02 -b ralph/s02-skeleton main
cd ../pixitween-s02
mkdir -p docs && ln -s ~/Documents/code/trolio/pixitween-director/docs/{hackathon,learn-improve} docs/   # specs are gitignored
ralph-tui run --prd ./ralph/prd-s02-skeleton.json --iterations 0
```
Check `.ralph-tui/config.toml` first (`agent = "claude"`, `autoCommit = false`).
When the run finishes, review the diff, run `npm run live -- s02-smoke --yes` (needs `.env`), then merge to `main` and
remove the worktree.

## 4. While Ralph runs
- [ ] `.env` from `.env.example`: set `META_API_KEY` (create it under **API keys**). Verify without printing it:
      `curl -s -o /dev/null -w "%{http_code}\n" https://api.meta.ai/v1/models -H "Authorization: Bearer $META_API_KEY"` → `200`.
- [ ] Meta **Spend limits**: set a monthly notification (e.g. A$50) at the bottom of the Billing page.
- [ ] Note that the A$7.49 outstanding balance is from before the credits. It bills on 1 Nov or at A$30.
- [ ] Clippy Pro account + token → `CLIPPY_TOKEN`, `CLIPPY_MCP_URL` (needed by Mon 2 Nov for S7).
- [ ] Discord intro in #intros.

## 5. Following waves (one worktree per PRD, merge before starting the next wave)
| When | Wave | PRDs |
|------|------|------|
| Thu 29 | 2 | `s03a-authoring-core`, `s07a-clippy-client`, `s08a-export-gallery` |
| Fri 30 | 3 | `s03b-director-agent`, `s04-art-layers`, `s05a-review-rules`, `s06-chat-edit` |
| Sat 31 | 4 | `s05b-review-visual`, `s07b-generate-integration`, `s08b-deploy`, `s09-local-mode`, `s11-mcp-server` |
| Sun 1 | 5 | `s10-docs-submission` |

Milestones: **M1** Sat 31 (brief → film in the browser + one self-review fix), **M2** Mon 2 (live URL),
**M3** Tue 3 23:59 ET (freeze), **M4** Wed 4 (submit by 12:00 ET; hard deadline 21:00 ET).
We're one day behind `02-timeline.md`. If it slips more, cut in this order: S11, S8a export, S9 Local mode.
