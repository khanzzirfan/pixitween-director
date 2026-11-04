# Local mode

## What it is

Local mode runs chat edits and frame review on Muse Glimmer 30B on your own computer, through Ollama, instead of Muse Spark through the Meta API. It is for privacy, for working without the Meta API, and for zero cost per edit. It is not a speed feature: see Speed below.

The switch is in the Chat panel header ("Local mode (Muse Glimmer)"). The badge next to it says which model made the last edit and how long it took. If the Meta API fails with a billing or server error while Local mode is off, the edit falls back to Glimmer when Ollama is running, and the badge says so.

## Run it

1. Install Ollama and pull the model: `ollama pull muse-glimmer:30b-mlx`
2. Start it: `ollama serve`
3. If your Ollama or model name differs, set `GLIMMER_BASE_URL` (default `http://localhost:11434`) and `GLIMMER_MODEL` (default `muse-glimmer:30b-mlx`) in `.env`.
4. Open the app and turn on the switch in the Chat panel. The switch stays disabled, with the reason, while Ollama is not reachable or the model is not pulled.

On a machine with under 24 GiB of VRAM, start Ollama with `OLLAMA_CONTEXT_LENGTH=32000`. Its default context there is 4k, and long prompts are silently truncated. The server logs `context truncation suspected` when a prompt looks cut short.

To set Local mode on at start-up, use `LOCAL_MODE=true`.

## What stays on your computer

- Chat edits: your message, the film's composition and the model's tool calls go to Ollama and nowhere else.
- Frame review: the captured frames are sent to Ollama as images and the verdict comes back as JSON.

## What still uses the Meta API

- Muse Image (new art and cut-outs), SAM 3.1, Voice Transcribe
- The storyboard and build agent calls
- Clippy generate mode (video clips)

Chat edits that ask for new art are not offered to the local model; those tools are removed in Local mode, so the model cannot call them. Local mode is not a fully private or disconnected mode: creating a film still needs the API.

## Speed

Muse Glimmer is slower than Muse Spark through the API. Our probes measured 19 to 33 s per tool turn on Glimmer against 13 to 16 s on Spark. Local mode skips the model's closing "DONE" turn when every tool call succeeded, which saves one turn per edit, but it does not change that ratio.

Numbers from `npm run live -- s09-local --yes` on your machine go here:

| edit | backend | correct | ms | tool calls ok | tok/s |
| --- | --- | --- | --- | --- | --- |
| (paste the table here) | | | | | |

## Troubleshooting

- **The switch is disabled:** the text under it says why. `Ollama is not reachable` means `ollama serve` is not running or `GLIMMER_BASE_URL` is wrong. `Model not found` means `ollama pull` has not been run for `GLIMMER_MODEL`.
- **The first edit is slow:** Ollama loads the model on first use. The server asks it to keep the model loaded for 30 minutes.
- **Edits are wrong or ignore part of the film:** look for `context truncation suspected` in the server log and raise the context length as above.
- **"model-missing" or "unreachable" in an error:** the same two causes as the disabled switch; Ollama went away after the switch was turned on.
