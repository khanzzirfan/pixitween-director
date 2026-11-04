// A finished film becomes an AI movie: each scene's picture is a reference frame, one prompt gives the shot order, and Fal's MiniMax H3
// reference-to-video makes one clip. The frames and the prompt carry no text on purpose: a video model garbles words, so the film's own
// type is meant to be laid over the clip, not drawn by the model.
import sharp from 'sharp';
import type { AiVideoQuote, AiVideoResolution } from '@shared/api';
import type { FilmState } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import { readDirector, sceneIds } from '../authoring/meta';
import { flatLayers, flattenScene } from '../generate/flatten';

type Comp = NonNullable<FilmState['composition']>;
type Aspect = '9:16' | '16:9' | '1:1';

/** MiniMax H3 Max reference-to-video on Fal. Prices are per second of clip, read from Fal's model page. */
export const H3_ENDPOINT = 'minimax/h3-max/reference-to-video';
export const H3_LIMITS = {
  minSec: 5,
  maxSec: 15,
  /** Reference pictures sent. Fal's page gives no hard cap; a handful is what the model keeps apart. */
  maxFrames: 4,
  usdPerSec: { '480P': 0.05, '768P': 0.08 } satisfies Record<AiVideoResolution, number>,
} as const;

/** How far into a scene its frame is drawn: late enough that the product has slid or popped into place. */
const FRAME_AT = 0.6;
/** Long side of a reference frame in pixels. */
const FRAME_LONG_SIDE = 1536;

const CAMERA_WORDS: Record<string, string> = {
  static: 'locked-off camera',
  'dolly-in': 'slow push-in',
  pan: 'slow pan',
  orbit: 'slow orbit around the product',
  parallax: 'gentle parallax drift',
};

export interface PlannedShot {
  sceneId: string;
  intent: string;
  camera: string;
  /** Seconds of the clip this shot takes. */
  sec: number;
  /** The scene's own length in frames, to pick the frame to draw. */
  sceneFrames: number;
}

export interface AiFilmPlan {
  aspect: Aspect;
  filmSec: number;
  durationSec: number;
  shots: PlannedShot[];
  skipped: string[];
  productNoun?: string;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const r1 = (n: number): number => Math.round(n * 10) / 10;

export function aspectOf(width: number, height: number): Aspect {
  if (height > width * 1.2) return '9:16';
  if (width > height * 1.2) return '16:9';
  return '1:1';
}

/** Evenly spaced picks, first and last always in. */
function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))]!);
}

/** Which scenes become frames, how long the clip is and how it is cut. Pure: reads the composition only. */
export function planAiFilm(comp: Comp): AiFilmPlan {
  const director = readDirector(comp);
  const scenes = sceneIds(comp).flatMap((id) => (director.scenes[id] ? [{ id, meta: director.scenes[id]! }] : []));
  const filmSec = scenes.reduce((n, s) => n + s.meta.durationFrames, 0) / comp.fps;
  const durationSec = clamp(Math.round(filmSec), H3_LIMITS.minSec, H3_LIMITS.maxSec);
  const usable = scenes.filter((s) => s.meta.mode !== 'generate' && flatLayers(comp, s.id).length > 0);
  const picked = spread(usable, H3_LIMITS.maxFrames);
  const frames = picked.reduce((n, s) => n + s.meta.durationFrames, 0) || 1;
  const shots = picked.map((s) => ({
    sceneId: s.id,
    intent: s.meta.intent?.trim() || 'the product on show',
    camera: CAMERA_WORDS[s.meta.camera?.move ?? ''] ?? 'gentle camera move',
    sec: r1((durationSec * s.meta.durationFrames) / frames),
    sceneFrames: s.meta.durationFrames,
  }));
  return {
    aspect: aspectOf(comp.width, comp.height),
    filmSec: r1(filmSec),
    durationSec,
    shots,
    skipped: scenes.filter((s) => !picked.some((p) => p.id === s.id)).map((s) => s.id),
    ...(director.productNoun ? { productNoun: director.productNoun } : {}),
  };
}

export function quoteAiFilm(plan: AiFilmPlan, resolution: AiVideoResolution): Omit<AiVideoQuote, 'keyReady'> {
  return {
    resolution,
    durationSec: plan.durationSec,
    filmSec: plan.filmSec,
    costUsd: Math.round(plan.durationSec * H3_LIMITS.usdPerSec[resolution] * 100) / 100,
    frames: plan.shots.length,
    skippedScenes: plan.skipped,
  };
}

const clock = (n: number): string => `${r1(n).toFixed(1)}s`;

/** One prompt for the whole clip: the shots in order, each tied to its reference picture, and what must not appear. */
export function buildAiFilmPrompt(plan: AiFilmPlan): string {
  let at = 0;
  const lines = plan.shots.map((shot, i) => {
    const from = at;
    at += shot.sec;
    return `Shot ${i + 1} (${clock(from)}-${clock(i === plan.shots.length - 1 ? plan.durationSec : at)}), Image ${i + 1}: ${shot.intent.replace(/\.+$/, '')}. Camera: ${shot.camera}.`;
  });
  return [
    `One continuous cinematic commercial, ${plan.aspect} frame, ${plan.shots.length} shots, ${plan.durationSec} seconds, smooth cuts between shots.`,
    `Each reference image is the look of the shot with its number.${plan.productNoun ? ` The product is ${/^[aeiou]/i.test(plan.productNoun) ? 'an' : 'a'} ${plan.productNoun}.` : ''} In every shot the product keeps the exact shape, colours, pattern and label it has in its reference image.`,
    ...lines,
    'Natural ambient sound, no speech. No on-screen text, no captions, no subtitles, no logos, no watermark. Never show the reference images as a grid, collage or storyboard.',
  ].join('\n');
}

/** The reference pictures, one per planned shot, as JPEGs: the scene's pictures flattened at a frame where the product is in place. */
export async function captureFrames(ctx: Pick<ToolCtx, 'assets'>, comp: Comp, plan: AiFilmPlan): Promise<Buffer[]> {
  const long = FRAME_LONG_SIDE;
  const short = Math.round((long * Math.min(comp.width, comp.height)) / Math.max(comp.width, comp.height) / 2) * 2;
  const size = comp.width >= comp.height ? { width: long, height: short } : { width: short, height: long };
  const frames: Buffer[] = [];
  for (const shot of plan.shots) {
    const png = await flattenScene(ctx, comp, shot.sceneId, size, Math.floor(shot.sceneFrames * FRAME_AT));
    frames.push(await sharp(png).jpeg({ quality: 90 }).toBuffer());
  }
  return frames;
}

export function buildH3Request(plan: AiFilmPlan, frameUrls: string[], resolution: AiVideoResolution): { model: string; input: Record<string, unknown> } {
  return {
    model: H3_ENDPOINT,
    input: {
      prompt: buildAiFilmPrompt(plan),
      duration: plan.durationSec,
      resolution,
      aspect_ratio: plan.aspect,
      // the prompt already says what each picture is for; a rewrite would loosen the product lock
      prompt_expansion_mode: 'disabled',
      reference_image_urls: frameUrls,
    },
  };
}
