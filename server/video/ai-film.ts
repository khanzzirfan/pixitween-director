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
  /** Reference pictures the model takes (clippy's model allowlist: fal H3 Max, 12).  */
  maxFrames: 12,
  /** One reference picture for each 3 s of clip: enough for the model to follow, few enough to keep each one meaningful. */
  secPerFrame: 3,
  usdPerSec: { '480P': 0.05, '768P': 0.08 } satisfies Record<AiVideoResolution, number>,
} as const;

/** Long side of a reference frame in pixels. */
const FRAME_LONG_SIDE = 1280;
/** A prompt past this is trimmed of its context first, the shot list last. */
const MAX_PROMPT = 3600;

const CAMERA_WORDS: Record<string, string> = {
  static: 'locked-off camera',
  'dolly-in': 'slow push-in',
  pan: 'slow pan',
  orbit: 'slow orbit around the product',
  parallax: 'gentle parallax drift',
};

export interface PlannedShot {
  sceneId: string;
  /** The frame of that scene to draw: where the film is at this shot's moment. */
  localFrame: number;
  intent: string;
  camera: string;
  /** Seconds of the clip this shot takes. */
  sec: number;
}

/** What the film's makers said, which the pictures alone do not carry: the brief, the chat and the look. */
export interface AiFilmContext {
  title?: string;
  /** The product's own name, as the brief gives it in quotes. */
  productName?: string;
  brief?: string;
  /** The conversation with the showrunner. */
  transcript?: string;
  style?: { mood?: string; light?: string; camera?: string; productLine?: string };
  /** Storyboard scene text by scene id: the scene's own intent is longer and better than the director meta's. */
  intents?: Record<string, string>;
  /** What each scene shows besides the product (props, passes, splashes), from its beats with the timings taken out. */
  props?: Record<string, string>;
}

export interface AiFilmPlan {
  aspect: Aspect;
  filmSec: number;
  durationSec: number;
  shots: PlannedShot[];
  skipped: string[];
  productNoun?: string;
  context: AiFilmContext;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const r1 = (n: number): number => Math.round(n * 10) / 10;
const squash = (t: string): string => t.replace(/\s+/g, ' ').trim();
/** The text up to a word break within `n`, with no ellipsis: a clipped sentence in a prompt reads as a command to stop mid-way. */
const sentence = (t: string, n: number): string => {
  if (t.length <= n) return t;
  const head = t.slice(0, n);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('; '), head.lastIndexOf(', '));
  return (stop > n * 0.5 ? head.slice(0, stop) : head.slice(0, head.lastIndexOf(' '))).trim();
};
const cut = (t: string, n: number): string => (t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`);

export function aspectOf(width: number, height: number): Aspect {
  if (height > width * 1.2) return '9:16';
  if (width > height * 1.2) return '16:9';
  return '1:1';
}

/** A scene's beats without the clauses that count seconds: the props and what happens to them stay, the timings are for the editor. */
const clausesWithoutTimings = (beats: string): string =>
  beats.split(/[.;](?:\s+|$)/).map(squash).filter((c) => c && !/\d+(\.\d+)?\s*s\b|\bms\b/.test(c)).join('; ');

/** The chat that matters to a movie: what the director asked for, newest last, and the showrunner's one-line statement of the film. Status chatter is left out. */
export function chatNotes(events: ReadonlyArray<{ type: string; from?: string; kind?: string; text?: string }>): string {
  const asked = events.filter((e) => e.type === 'showrunner.heard' && e.from === 'user' && e.text?.trim()).map((e) => `Director: ${squash(e.text!)}`).slice(-6);
  const line = events.find((e) => e.type === 'showrunner.say' && e.text?.startsWith('Film in one line'))?.text;
  return [...(line ? [squash(line)] : []), ...asked].join(' ');
}

/** The context an AI movie reads from a film: its brief (up to the shot list, which the pictures already say), the chat and the style bible. */
export function aiFilmContext(film: Pick<FilmState, 'title' | 'brief' | 'styleBible' | 'storyboard'>, chat = ''): AiFilmContext {
  const paragraphs = (film.brief?.text ?? '').split(/\n\s*\n/).map(squash).filter(Boolean);
  const head = paragraphs.slice(0, Math.max(1, paragraphs.findIndex((p) => /^shot\s*\d/i.test(p)) < 0 ? 2 : paragraphs.findIndex((p) => /^shot\s*\d/i.test(p))));
  const sb = film.styleBible as { mood?: string; light?: string; camera?: string; productLine?: string } | undefined;
  return {
    ...(film.title ? { title: film.title } : {}),
    ...(head.length ? { brief: head.join(' ') } : {}),
    ...(film.brief?.text.match(/"([^"]{2,40})"/) ? { productName: film.brief.text.match(/"([^"]{2,40})"/)![1] } : {}),
    ...([film.brief?.transcript ? squash(film.brief.transcript) : '', chat].filter(Boolean).join(' ') ? { transcript: [film.brief?.transcript ? squash(film.brief.transcript) : '', chat].filter(Boolean).join(' ') } : {}),
    ...(sb ? { style: { mood: sb.mood, light: sb.light, camera: sb.camera, productLine: sb.productLine } } : {}),
    intents: Object.fromEntries((film.storyboard?.scenes ?? []).map((sc) => [sc.id, sc.intent])),
    props: Object.fromEntries((film.storyboard?.scenes ?? []).flatMap((sc) => { const kept = clausesWithoutTimings(sc.beats ?? ''); return kept ? [[sc.id, kept]] : []; })),
  };
}

/** How the film's moments become reference frames and how the clip is cut: one frame per second of the clip, in timeline order.
 *  A moment that falls in a scene with no picture borrows the nearest scene that has one. Pure: reads the composition only. */
export function planAiFilm(comp: Comp, context: AiFilmContext = {}): AiFilmPlan {
  const director = readDirector(comp);
  let at = 0;
  const scenes = sceneIds(comp).flatMap((id) => {
    const meta = director.scenes[id];
    if (!meta) return [];
    const scene = { id, meta, start: at, end: at + meta.durationFrames, usable: meta.mode !== 'generate' && flatLayers(comp, id).length > 0 };
    at = scene.end;
    return [scene];
  });
  const totalFrames = at;
  const filmSec = totalFrames / comp.fps;
  const durationSec = clamp(Math.round(filmSec), H3_LIMITS.minSec, H3_LIMITS.maxSec);
  const usable = scenes.filter((sc) => sc.usable);
  const count = usable.length ? Math.min(H3_LIMITS.maxFrames, Math.max(1, Math.round(durationSec / H3_LIMITS.secPerFrame))) : 0;
  const sec = durationSec / (count || 1);
  const shotsOfScene = new Set<string>();
  const shots: PlannedShot[] = Array.from({ length: count }, (_, i) => {
    const t = ((i + 0.5) / count) * totalFrames;
    const home = scenes.find((sc) => t >= sc.start && t < sc.end) ?? scenes.at(-1)!;
    const scene = home.usable ? home : usable.reduce((best, sc) => (Math.abs((sc.start + sc.end) / 2 - t) < Math.abs((best.start + best.end) / 2 - t) ? sc : best));
    const local = home.usable ? t - scene.start : (scene.end - scene.start) * 0.6;
    const shot = {
      sceneId: scene.id,
      localFrame: clamp(Math.floor(local), 0, Math.max(0, scene.meta.durationFrames - 1)),
      // a scene's words once, on its first frame; its later frames are the same shot a moment on
      intent: shotsOfScene.has(scene.id) ? 'the same shot a moment later, the motion carrying on' : sentence([squash(context.intents?.[scene.id] ?? scene.meta.intent ?? '') || 'the product on show', context.props?.[scene.id] ? `Elements: ${context.props[scene.id]}` : ''].filter(Boolean).join(' '), 320),
      camera: CAMERA_WORDS[scene.meta.camera?.move ?? ''] ?? 'gentle camera move',
      sec,
    };
    shotsOfScene.add(scene.id);
    return shot;
  });
  const used = new Set(shots.map((sh) => sh.sceneId));
  return {
    aspect: aspectOf(comp.width, comp.height),
    filmSec: r1(filmSec),
    durationSec,
    shots,
    skipped: scenes.filter((sc) => !used.has(sc.id)).map((sc) => sc.id),
    ...(director.productNoun ? { productNoun: director.productNoun } : {}),
    context,
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

/** What the film is, in the words of the people who made it: subject, look and the chat's notes. Each part is capped; `level` drops the longest first. */
function contextLines(plan: AiFilmPlan, level: number): string[] {
  const { brief, transcript, style } = plan.context;
  const lines: string[] = [];
  const subject = plan.productNoun ?? undefined;
  const name = plan.context.productName;
  const noun = subject ? `${/^[aeiou]/i.test(subject) ? 'an' : 'a'} ${subject}` : '';
  if (name || noun) lines.push(`Subject: ${name ? `${name}${noun ? `, ${noun}` : ''}` : noun}.`);
  if (style?.productLine) lines.push(`Hero: ${cut(squash(style.productLine), 160)}.`);
  const look = [style?.mood, style?.light].filter(Boolean).map((x) => squash(x!));
  if (look.length) lines.push(`Look: ${cut(look.join('; '), 220)}.`);
  if (level < 2 && brief) lines.push(`Brief: ${cut(brief, 450)}`);
  if (level < 1 && transcript) lines.push(`Notes from the chat with the director: ${cut(transcript.slice(-700), 600)}`);
  return lines;
}

/** One prompt for the whole clip: what the film is, then the shots in order, each tied to its reference picture, and what must not appear. */
export function buildAiFilmPrompt(plan: AiFilmPlan): string {
  const sec = plan.durationSec / (plan.shots.length || 1);
  const shots = plan.shots.map((shot, i) => `Shot ${i + 1} (${clock(i * sec)}-${clock(i === plan.shots.length - 1 ? plan.durationSec : (i + 1) * sec)}), Image ${i + 1}: ${shot.intent.replace(/\.+$/, '')}. Camera: ${shot.camera}.`);
  const build = (level: number): string =>
    [
      `One continuous cinematic commercial, ${plan.aspect} frame, ${plan.durationSec} seconds, ${plan.shots.length} reference images in time order, one per ${r1(sec)} seconds: follow them image by image, in sequence, with smooth cuts.`,
      ...contextLines(plan, level),
      `Each reference image is the look of the shot with its number. In every shot the product keeps the exact shape, colours, pattern and label it has in its reference image.`,
      ...shots,
      'Natural ambient sound, no speech. No on-screen text, no captions, no subtitles, no logos, no watermark. Never show the reference images as a grid, collage or storyboard.',
    ].join('\n');
  for (const level of [0, 1, 2]) {
    const prompt = build(level);
    if (prompt.length <= MAX_PROMPT) return prompt;
  }
  return build(2);
}

/** The reference pictures, one per planned shot, as JPEGs: the scene's pictures flattened where the film is at that moment. */
export async function captureFrames(ctx: Pick<ToolCtx, 'assets'>, comp: Comp, plan: AiFilmPlan): Promise<Buffer[]> {
  const long = FRAME_LONG_SIDE;
  const short = Math.round((long * Math.min(comp.width, comp.height)) / Math.max(comp.width, comp.height) / 2) * 2;
  const size = comp.width >= comp.height ? { width: long, height: short } : { width: short, height: long };
  const frames: Buffer[] = [];
  for (const shot of plan.shots) {
    const png = await flattenScene(ctx, comp, shot.sceneId, size, shot.localFrame);
    frames.push(await sharp(png).jpeg({ quality: 88 }).toBuffer());
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
