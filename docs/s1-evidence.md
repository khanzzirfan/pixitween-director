# S1 evidence: what we measured on day 1

On 27 Oct 2026 we probed the Meta Model API live before writing code, to learn what each model can do and how fast. The recorded responses are in `fixtures/seed/` and the tests build on them. The probe scripts and raw dumps are not copied into this repository: they live in the author's monorepo checkout, so the numbers below are reported, not reproducible from here.

## What was probed

| Fixture | What it holds |
|---------|---------------|
| `sam-image-product.sse.txt` | SAM 3.1 image stream for the product photo |
| `sam-image-scene.sse.txt` | SAM 3.1 image stream for the café scene |
| `sam-video-truncated.sse.txt` | SAM 3.1 video stream, truncated |
| `spark-storyboard-response.json` | Muse Spark strict-schema storyboard |
| `spark-tool-loop-turns.json` | Muse Spark parallel tool calls |
| `spark-vision-image-response.json` | Muse Spark frame review |
| `transcribe-brief-response.json` | Muse Voice Transcribe push-to-talk |
| `transcribe-film-diarization-response.json` | Muse Voice Transcribe diarization |
| `glimmer-scene-turns.json` | Muse Glimmer scene tool turns |
| `glimmer-edit-1-turns.json` | Muse Glimmer chat edit turns |
| `brief-16k.wav` | the spoken test brief |
| `mug-product.png` | the product photo |
| `cafe-with-mug.jpg` | Muse Image edit result |
| `cafe-plate.jpg` | Muse Image empty plate |
| `mug-cutout-rgba.png` | the SAM cut-out |

## Results

| Model | Finding | Time |
|-------|---------|------|
| SAM 3.1 image | one object, clean full-resolution mask | 3 to 5 s |
| SAM 3.1 video | the cup tracked in all 240 frames | 13 s |
| Muse Voice Transcribe | keywords honoured; some doubled words | 4.4 s |
| Muse Spark tools | six parallel tool calls make one scene | 15.5 s |
| Muse Spark closing turn | "DONE" after the tool results | 2.6 s |
| Muse Image edit | the mug kept its shape in a new scene | 21.6 s |
| Muse Image generation | an empty plate for the background | 12.4 s |
| Muse Spark burst | 16 scene builders at once, all succeeded | 29 s |
| Muse Spark alone | one scene builder, the same request | 17 s |

## How to reproduce

The live checks that spend money print an estimate and run only with `--yes`: `npm run live -- <name> --yes`. The eight planned gates are `s02-smoke`, `s03-director`, `s04-art`, `s05-review`, `s06-chat`, `s07-generate`, `s09-local` and `s11-mcp`. Of these, `s04-art`, `s06-chat` and `s11-mcp` were not written; their areas are covered by offline tests. The original day-one probe scripts are not copied into this repository.
