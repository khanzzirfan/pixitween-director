# Muse Spark Open on Baseten

Muse Spark Open is Meta's open-weights model (816B, so it cannot run on a laptop). For this project it runs only on Baseten, through the hackathon credits ($100 and up to 2M tokens per minute).

## Status in this repo

| Piece | State |
|-------|-------|
| `BASETEN_API_KEY`, `EDIT_BACKEND` in `server/env.ts` and `.env.example` | Done. |
| `server/llm/spark-open-backend.ts` (`createSparkOpenBackend`) | Done. Reuses the Meta HTTP and Spark clients (the API is OpenAI-compatible), pointed at Baseten, with `max_tokens` 4096. |
| Router | Done. With `EDIT_BACKEND=spark-open`, **chat edits** use Spark Open. Storyboard, build and review stay on Meta Spark. A missing key fails at startup of the first edit with a clear error. |
| Cost | Recorded at $0 while hackathon credits cover it (no per-token price is published for the key). Token counts are in the ledger units. |
| Frame review on Spark Open | Not built. Review still uses Meta Spark. |

To use it, set `BASETEN_API_KEY` and `EDIT_BACKEND=spark-open` in `.env` and restart the server. The agent turn event then reports `backend: 'spark-open'`.

## 1. Get the key

1. Open the "Your Baseten API key is ready" email and use its key link.
2. **The link works once.** Copy the key immediately and keep it in a password manager.
3. Never paste the key into chat, an issue, a commit, or a screenshot. If it leaks, revoke it in the Baseten dashboard and make a new one.

## 2. Store it

Put it in `.env` (gitignored; check with `git check-ignore .env`):

```
BASETEN_API_KEY=<your key>
# only when the Baseten backend is wired up:
# EDIT_BACKEND=spark-open
```

Server-side only. It must never reach the browser bundle (`npm run check:bundle` guards this). Leave it empty in `.env.example`.

## 3. Check the key works

Run this once from your shell. It reads the key from the environment, so it never appears in the command line or the shell history:

```sh
set -a; . ./.env; set +a
curl -sS https://inference.baseten.co/v1/chat/completions \
  -H "Authorization: Bearer $BASETEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-models/muse-spark-open-1026","messages":[{"role":"user","content":"Say hello in five words."}]}'
```

A `200` with a `choices[0].message.content` means the key is good. A `401` means a wrong or revoked key. A `404` or "model not found" means the wrong model name.

### Smoke test

`npm run live -- baseten-smoke --yes` (about $0.01) makes a plain call and a tool call. Last run, 29 Oct 2026: both passed. The reply was `ready` in 1.7 s (152+68 tokens, reasoning present), and the tool call returned `scaleLayer({"layerId": ..., "factor": 1.5})` in 2.7 s (646+587 tokens). Reasoning tokens count as output, so a one-word answer used 68 and a simple tool call used 587. Keep `max_tokens` generous and budget 5-10x the visible output.

## 4. The three facts that are easy to get wrong

- **Base URL:** `https://inference.baseten.co/v1` (OpenAI-compatible; the path is `/chat/completions`).
- **Model name:** exactly `meta-models/muse-spark-open-1026`. The Baseten docs say `meta-models/muse-spark-open`. Do not use that: the hackathon key only works with the `-1026` model.
- **It always reasons.** Replies may include reasoning output before the answer. Read only the final message content, and when you expect JSON, parse defensively. The visual review already retries once on a non-JSON answer.

Vision and audio are supported through the same endpoint (images as OpenAI-style `image_url` content parts). See Baseten's "Vision and Audio" page before using it for frame review.

## 5. Checking it live

- `npm run live -- baseten-smoke --yes` (about $0.01): the raw API, a plain call and a tool call.
- `npm run live -- spark-open-edit --yes` (about $0.005): one edit through the app's own backend, with a layer list in the prompt. It passes only if the model calls a tool on a real layer id.

Both print the cost first and run only with `--yes`. Tests for the backend use a local fake server, so CI never calls Baseten.

## 5b. What is left

- A Spark Open `Reviewer` for frame review through `pickReviewer`, if you want vision review on the open-weight model.
- A real price in `server/agent/edit-cost.ts` once Baseten's rate for the model is known.

## 6. For the submission

The hackathon's open-weight bonus asks which model was used and where it ran. Once step 5 is done, the answer is: Muse Spark Open (`meta-models/muse-spark-open-1026`) on Baseten, plus Muse Glimmer 30B on the owner's own Mac through Ollama.
