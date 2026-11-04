# Submission answers

Paste-ready text for the Cerebral Valley form: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit

## Basics

- **Project name:** MuseReels
- **Track:** Startup. Theme: Build for Your World.
- **Team:** Irfan, solo founder (Representative).
- **Demo video (2:49):** https://youtu.be/xi4DvqrCDm8
- **Code (Apache-2.0):** https://github.com/khanzzirfan/pixitween-director

## Tagline

One product photo and one sentence in. A directed 3D ad out, in about four minutes, for cents.

## Short description

MuseReels turns a product photo and one sentence, or a whole product CSV, into a 10-second vertical 3D ad. Muse Spark directs the film. Before anything is assembled, our own 3D engine draws every part on a sheet, and Muse checks it against the photo, so mistakes are caught on a cheap picture and not in the finished ad. Export the 3D film as an MP4 for free, or send its frames to a video model for a final AI movie.

## Impact (30%)

Small online sellers have hundreds of products and no budget for a video shoot, yet short vertical video is where buyers look. Generating each ad with a video model is expensive and hard to steer: the product changes shape, prices come out as invented text, and every retry costs money.

MuseReels makes the ad cheap enough to make for every product. A film costs 3.5 to 6.5 cents in Meta calls (measured on 4 Nov with the `muse-spark-1.3-contributor` tier) and takes 2.5 to 5 minutes. A CSV of the shop's catalog makes one film per product, with the title and price taken from the feed. The seller only pays for a video model once they like the 3D film.

## Use of Meta AI tooling (25%)

Four Meta models each do a distinct job:

- **Muse Spark 1.3** is the director. It writes the board (concept, shots, camera, light, grade, set and elements) as strict JSON, reads the product's form from the photo, checks the rendered sheets against the photo, looks over the film sheet, and revises the board once.
- **SAM 3.1** cuts the product out. The outline becomes the product's 3D body and the pixels become what it wears, so the real product is in every shot.
- **Muse Image** draws the elements around the product (berries, ice, steam). We also used it to make the strawberry and blueberry tubs in the demo catalog.
- **Muse Voice Transcribe** takes a spoken brief.

What goes beyond a basic integration: Muse Spark reviews pictures that our own engine renders, not pictures from an image model. The engine draws each part and the finished film onto labelled sheets in headless Chromium, and Muse uses its vision to compare them with the customer's photo before the film is committed. That turns a vision model into a cheap quality check for a 3D pipeline.

## Technical depth and execution (20%)

- The film is data, not video. Muse's board becomes a composition JSON that our own Motion engine (GSAP and Three.js) plays. The same engine runs in the browser and in headless Chromium on the server, so what Muse checks is exactly what plays.
- Code rules keep Muse safe: they build the 3D world and the product body, and set the title and price as real 3D text, so a model never draws a price.
- Five steps run in order (parts, sheets, check, film sheet, commit), with a live step clock, an event log, and a logged cost for every Meta call.
- A catalog run makes one film per CSV row, one to four at a time. A failure never stops the rest, and it resumes after a restart.
- Export: an MP4 encoded in the page, or an AI movie from Fal's MiniMax H3 guided by the 3D film's own frames, with the visitor's own Fal key.

## Demo (25%)

The 2:49 video, narrated in the founder's own voice, follows one film through the whole pipeline: a photo and one sentence, Muse Spark writing the shot plan, the product and element sheets, Muse's critique of those sheets (it catches a blueberry with a missing patch), code rules checking every cut, steering in plain words, the finished 3D film, the editable shot cards, MP4 and AI movie export, and a three-flavour yoghurt CSV run with prices from the feed. The README has a 10-minute path to run it locally with only a Meta API key.

## Honest limits

Listed in the README: every film shares one 3D scaffold, the product wears one photo, a finished film cannot yet be edited in chat, and the AI movie carries no text and can invent small print.

## Bonus prizes

| Prize | Claim |
|-------|-------|
| Community vote | Share the demo video and repo. |
| Most viral | X post below. |
