// S22 live: the AI movie, end to end. Takes a finished film, draws one reference frame per scene, uploads them to Fal, makes one clip with
// MiniMax H3 reference-to-video, polls until it is done and saves the MP4. This is the same path the Export panel's "Make AI movie" button runs.
// Spends the Fal key in the FAL_API_KEY environment variable of this shell (the server itself has none). The estimate is the most a clip can cost (15 s); the real quote for the film is printed before anything is sent.
// Writes the frames, the contact sheet, the request, the result and out.mp4 to debug/s22-ai-video-<stamp>/.
// Usage: FAL_API_KEY=<key> npm run live -- s22-ai-video --film=film_xxxxxxxxxxxx [--res=480P|768P] [--yes]
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { AI_VIDEO_RESOLUTIONS, type AiVideoResolution } from '@shared/api';
import { isFilmId } from '@shared/composition';
import { createFalClient } from '../../server/fal/client';
import { buildDeps } from '../../server/main';
import { buildH3Request, captureFrames, H3_LIMITS, planAiFilm, quoteAiFilm } from '../../server/video/ai-film';
import type { LiveScript } from './run';

const POLL_MS = 5_000;

const resolutionOf = (args: string[] = []): AiVideoResolution => {
  const given = args.find((a) => a.startsWith('--res='))?.slice(6);
  if (given === undefined) return '480P';
  if (!(AI_VIDEO_RESOLUTIONS as readonly string[]).includes(given)) throw new Error(`--res must be one of ${AI_VIDEO_RESOLUTIONS.join(', ')}`);
  return given as AiVideoResolution;
};

export const describe: LiveScript['describe'] = () =>
  'S22 live: makes an AI movie from a finished film with Fal MiniMax H3 (reference frames in, one clip out). Needs FAL_API_KEY in your shell. Pass --film=<film id> and optionally --res=480P|768P. Writes debug/s22-ai-video-<stamp>/.';

export const estimateUsd: LiveScript['estimateUsd'] = (args) => Math.round(H3_LIMITS.maxSec * H3_LIMITS.usdPerSec[resolutionOf(args)] * 100) / 100;

export const run: LiveScript['run'] = async ({ env, log, args }) => {
  const falKey = process.env.FAL_API_KEY;
  if (!falKey) throw new Error('FAL_API_KEY is required for s22-ai-video (export it in your shell; the server has none)');
  const filmId = args?.find((a) => a.startsWith('--film='))?.slice(7);
  if (!isFilmId(filmId)) throw new Error('Pass --film=<film id>, for example --film=film_0123456789ab');
  const resolution = resolutionOf(args);

  const deps = await buildDeps(env);
  const film = await deps.films.get(filmId);
  if (!film.composition) throw new Error(`${filmId} has no composition yet`);
  const plan = planAiFilm(film.composition);
  if (!plan.shots.length) throw new Error(`${filmId} has no scene with pictures to make a movie from`);
  const quote = quoteAiFilm(plan, resolution);
  log(`${film.title ?? filmId}: ${plan.shots.length} frames from ${plan.shots.map((s) => s.sceneId).join(', ')}${plan.skipped.length ? ` (left out: ${plan.skipped.join(', ')})` : ''}`);
  log(`quote: ${quote.durationSec} s clip at ${resolution} = $${quote.costUsd.toFixed(2)} (film is ${plan.filmSec} s)`);

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const dir = `debug/s22-ai-video-${stamp}`;
  mkdirSync(dir, { recursive: true });

  const frames = await captureFrames({ assets: deps.assets }, film.composition, plan);
  frames.forEach((f, i) => writeFileSync(`${dir}/shot-${i + 1}.jpg`, f));
  const thumbs = await Promise.all(frames.map((f) => sharp(f).resize({ height: 480 }).png().toBuffer()));
  const widths = await Promise.all(thumbs.map(async (t) => (await sharp(t).metadata()).width ?? 0));
  await sharp({ create: { width: widths.reduce((a, b) => a + b, 0), height: 480, channels: 3, background: '#ffffff' } })
    .composite(thumbs.map((input, i) => ({ input, left: widths.slice(0, i).reduce((a, b) => a + b, 0), top: 0 })))
    .png()
    .toFile(`${dir}/contact.png`);

  const client = createFalClient({ apiKey: falKey });
  const urls: string[] = [];
  for (const [i, frame] of frames.entries()) urls.push(await client.upload(frame, 'image/jpeg', `${filmId}-shot-${i + 1}.jpg`));
  const request = buildH3Request(plan, urls, resolution);
  writeFileSync(`${dir}/request.json`, JSON.stringify(request, null, 2));
  writeFileSync(`${dir}/prompt.txt`, String(request.input.prompt));
  log(`submitting ${request.model} (frames in ${dir}/contact.png, prompt in ${dir}/prompt.txt)`);

  const handle = await client.submit(request.model, request.input);
  log(`request ${handle.requestId}`);
  const started = Date.now();
  for (;;) {
    const status = await client.status(handle);
    log(`${Math.round((Date.now() - started) / 1000)}s ${status.status}${status.queuePosition !== undefined ? ` (queue ${status.queuePosition})` : ''}`);
    if (status.status === 'COMPLETED') break;
    if (status.status === 'FAILED' || status.status === 'CANCELLED') throw new Error(`Fal request ${handle.requestId} ${status.status}`);
    if (Date.now() - started > 20 * 60_000) throw new Error(`Fal request ${handle.requestId} still running after 20 minutes; it may finish and bill anyway`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const result = await client.result(handle);
  writeFileSync(`${dir}/result.json`, JSON.stringify(result.raw, null, 2));
  if (!result.videoUrl) throw new Error('Fal finished without a video url; see result.json');
  const mp4 = await fetch(result.videoUrl);
  if (!mp4.ok) throw new Error(`Could not download the video (${mp4.status})`);
  writeFileSync(`${dir}/out.mp4`, Buffer.from(await mp4.arrayBuffer()));
  log(`done: ${dir}/out.mp4 (about $${quote.costUsd.toFixed(2)})`);
};
