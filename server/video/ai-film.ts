// A finished film becomes an AI movie: each shot's picture is a reference frame, one prompt gives the shot order, and Fal's MiniMax H3
// reference-to-video makes one clip. A 2D film's frames are its scene pictures flattened; a 3D film's are its own render, drawn headless at
// the middle of each camera shot with the film's titles taken out. The frames and the prompt carry no text on purpose: a video model garbles words, so the film's own
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
  /** A 3D film's frames are drawn by the stage at this second of the film; a 2D film's by flattening `localFrame` of its scene. */
  atSec?: number;
}

/** What the film's makers said, which the pictures alone do not carry: the brief, the chat and the look. */
export interface AiFilmContext {
  title?: string;
  /** The product's own name, as the brief gives it in quotes. */
  productName?: string;
  brief?: string;
  /** Muse's one-line story of the film: the board's concept, as its last revision left it. */
  concept?: string;
  /** The conversation with the showrunner. */
  transcript?: string;
  style?: { mood?: string; light?: string; camera?: string; productLine?: string };
  /** Storyboard scene text by scene id: the scene's own intent is longer and better than the director meta's. */
  intents?: Record<string, string>;
  /** What each scene shows besides the product (props, passes, splashes), from its beats with the timings taken out. */
  props?: Record<string, string>;
  /** The storyboard in order, for a film whose shots are not its scenes (a 3D film is one scene cut by its camera). */
  storyboard?: Array<{ durationSec: number; intent: string }>;
}

export interface AiFilmPlan {
  aspect: Aspect;
  filmSec: number;
  durationSec: number;
  shots: PlannedShot[];
  skipped: string[];
  productNoun?: string;
  context: AiFilmContext;
  /** True when the frames are drawn by the 3D stage. */
  stage3d?: boolean;
  /** What a 3D film shows besides the product, from its layers ("brew swirl, cream, bokeh"). */
  elements?: string;
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

/** Muse's story of a 3D film: the concept of the board it wrote, or of the last board it revised, from the film's own log. */
export function museConcept(events: ReadonlyArray<{ type: string; text?: string }>): string {
  const found = events.flatMap((e) => {
    if (e.type !== 'showrunner.say' || !e.text) return [];
    const m = /^(?:board by muse|Muse revised the board[^:]*): (.+)$/.exec(e.text);
    return m ? [squash(m[1]!.replace(/\s*\(a body from[^)]*\)\s*$/, ''))] : [];
  });
  return found.at(-1) ?? '';
}

/** The context an AI movie reads from a film: its brief (up to the shot list, which the pictures already say), the chat, Muse's story and the style bible. */
export function aiFilmContext(film: Pick<FilmState, 'title' | 'brief' | 'styleBible' | 'storyboard'>, chat = '', concept = ''): AiFilmContext {
  const paragraphs = (film.brief?.text ?? '').split(/\n\s*\n/).map(squash).filter(Boolean);
  const head = paragraphs.slice(0, Math.max(1, paragraphs.findIndex((p) => /^shot\s*\d/i.test(p)) < 0 ? 2 : paragraphs.findIndex((p) => /^shot\s*\d/i.test(p))));
  const sb = film.styleBible as { mood?: string; light?: string; camera?: string; productLine?: string } | undefined;
  return {
    ...(film.title ? { title: film.title } : {}),
    ...(concept ? { concept } : {}),
    ...(head.length ? { brief: head.join(' ') } : {}),
    ...(film.brief?.text.match(/"([^"]{2,40})"/) ? { productName: film.brief.text.match(/"([^"]{2,40})"/)![1] } : {}),
    ...([film.brief?.transcript ? squash(film.brief.transcript) : '', chat].filter(Boolean).join(' ') ? { transcript: [film.brief?.transcript ? squash(film.brief.transcript) : '', chat].filter(Boolean).join(' ') } : {}),
    ...(sb ? { style: { mood: sb.mood, light: sb.light, camera: sb.camera, productLine: sb.productLine } } : {}),
    intents: Object.fromEntries((film.storyboard?.scenes ?? []).map((sc) => [sc.id, sc.intent])),
    storyboard: (film.storyboard?.scenes ?? []).map((sc) => ({ durationSec: sc.durationSec, intent: squash(sc.intent ?? '') })).filter((sc) => sc.intent),
    props: Object.fromEntries((film.storyboard?.scenes ?? []).flatMap((sc) => { const kept = clausesWithoutTimings(sc.beats ?? ''); return kept ? [[sc.id, kept]] : []; })),
  };
}

/** How the film's moments become reference frames and how the clip is cut: one frame per second of the clip, in timeline order.
 *  A moment that falls in a scene with no picture borrows the nearest scene that has one. Pure: reads the composition only. */
export function planAiFilm(comp: Comp, context: AiFilmContext = {}): AiFilmPlan {
  if (stage3dWorld(comp)) return planStage3d(comp, context);
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


// ---- 3D films -------------------------------------------------------------------------------------------------------------------------
// A 3D film is one scene: a shape background, a stage3d world with a camera, a 3D product and its elements. It has no picture layers to
// flatten, so its shots are read from the camera (a hold keyframe ends a shot) and each shot's frame is drawn by the stage itself.

type Vec3 = [number, number, number];
interface CamKf { t: number; v: Vec3; hold?: boolean }
interface SceneRef { id: string; start: number; frames: number }

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number');
const kfsOf = (f: unknown): CamKf[] =>
  Array.isArray(f) && f.length > 0 && typeof f[0] === 'object' && !Array.isArray(f[0])
    ? (f as CamKf[]).filter((k) => typeof k.t === 'number' && isVec3(k.v)).sort((a, b) => a.t - b.t)
    : isVec3(f) ? [{ t: 0, v: f }] : [];

const posAt = (kfs: CamKf[], frame: number): Vec3 => {
  if (frame <= kfs[0]!.t) return kfs[0]!.v;
  const last = kfs[kfs.length - 1]!;
  if (frame >= last.t) return last.v;
  const i = kfs.findIndex((k, j) => frame >= k.t && frame < kfs[j + 1]!.t);
  const a = kfs[i]!;
  const b = kfs[i + 1]!;
  const p = a.hold ? 0 : (frame - a.t) / (b.t - a.t);
  return [0, 1, 2].map((k) => a.v[k]! + (b.v[k]! - a.v[k]!) * p) as Vec3;
};

/** The scene layer that carries the camera: the stage3d layer with a camera (the titles' stage has none). */
function stage3dWorld(comp: Comp): { scene: SceneRef; layer: Record<string, any> } | undefined {
  let at = 0;
  const director = readDirector(comp);
  for (const id of sceneIds(comp)) {
    const meta = director.scenes[id];
    if (!meta) continue;
    const layers = ((comp.precomps as Record<string, { layers: Array<Record<string, any>> }> | undefined)?.[id]?.layers ?? []);
    const layer = layers.find((l) => l.kind === 'stage3d' && l.camera);
    if (layer) return { scene: { id, start: at, frames: meta.durationFrames }, layer };
    at += meta.durationFrames;
  }
  return undefined;
}

/** Frame spans of the camera's shots: a hold keyframe ends one and the next keyframe begins the next. */
export function shotSpans(layer: Record<string, any>, frames: number, fps: number): Array<[number, number]> {
  const kfs = kfsOf(layer.camera?.position);
  const spans: Array<[number, number]> = [];
  let start = 0;
  for (const k of kfs) {
    if (k.hold && k.t > start) {
      spans.push([start, k.t]);
      start = k.t + 1;
    }
  }
  if (frames - start > 1) spans.push([start, frames]);
  const out = spans.length > 1 ? spans : [];
  if (out.length) return out;
  // a camera with no holds: even shots, about one for each 3 s
  const n = Math.max(1, Math.round(frames / fps / H3_LIMITS.secPerFrame));
  return Array.from({ length: n }, (_, i) => [Math.round((i * frames) / n), Math.round(((i + 1) * frames) / n)] as [number, number]);
}

/** What the camera does across a span, in a film-maker's words, from where it stands at the start and the end. */
export function cameraWords3d(layer: Record<string, any>, span: [number, number]): string {
  const kfs = kfsOf(layer.camera?.position);
  if (!kfs.length) return 'gentle camera move';
  const target = kfsOf(layer.camera?.target)[0]?.v ?? [0, 0, 0];
  const a = posAt(kfs, span[0]);
  const b = posAt(kfs, span[1]);
  const radius = (p: Vec3) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
  const angle = (p: Vec3) => Math.atan2(p[0] - target[0], p[2] - target[2]);
  const ratio = radius(b) / (radius(a) || 1);
  let turn = angle(b) - angle(a);
  if (turn > Math.PI) turn -= 2 * Math.PI;
  if (turn < -Math.PI) turn += 2 * Math.PI;
  const arc = Math.abs(turn) > 0.35 ? 'an orbit around the product' : Math.abs(turn) > 0.12 ? 'a slight arc' : '';
  const move = ratio < 0.9 ? 'slow push-in' : ratio > 1.1 ? 'slow pull-back' : '';
  if (move && arc) return `${move} with ${arc}`;
  if (move) return move;
  if (arc) return Math.abs(turn) > 0.35 ? 'slow orbit around the product' : 'gentle drift with a slight arc';
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 0.05 ? 'gentle camera drift' : 'locked-off camera';
}

/** The names of what the film shows besides the product ("brew swirl, cream, bokeh"), from its layer ids. */
function elementNames(comp: Comp, sceneId: string): string {
  const layers = (comp.precomps as Record<string, { layers: Array<{ id: string }> }> | undefined)?.[sceneId]?.layers ?? [];
  const names = layers.flatMap((l) => {
    const m = /^[^:]*:(?:ing\d+|air)-?(.*?)\d*$/.exec(l.id);
    return m && m[1] ? [m[1].replace(/-/g, ' ')] : [];
  });
  return [...new Set(names)].join(', ');
}

/** The framing word the director meta's one-line shot list gives each shot ("medium push, close push, ..."), when it names one for every shot. */
function framings(intent: string | undefined, n: number): string[] {
  const list = (intent ?? '').split(':').slice(1).join(':').split(',').map((x) => squash(x).toLowerCase()).filter(Boolean);
  if (list.length !== n) return [];
  return list.map((x) => (/^(wide|medium|close|detail|macro|full)\b/.exec(x)?.[1] ?? ''));
}

/** The film without its titles: the clip's model garbles words, so the reference frames show the set and the product and the type is laid on after. */
export function withoutTitles(comp: Comp): Comp {
  const out = structuredClone(comp);
  for (const pre of Object.values((out.precomps ?? {}) as Record<string, { layers: Array<{ id: string }> }>)) pre.layers = pre.layers.filter((l) => !/^[^:]*:title/.test(l.id));
  return out;
}

function planStage3d(comp: Comp, context: AiFilmContext): AiFilmPlan {
  const director = readDirector(comp);
  const { scene, layer } = stage3dWorld(comp)!;
  const totalFrames = sceneIds(comp).reduce((n, id) => n + (director.scenes[id]?.durationFrames ?? 0), 0);
  const filmSec = totalFrames / comp.fps;
  const durationSec = clamp(Math.round(filmSec), H3_LIMITS.minSec, H3_LIMITS.maxSec);
  const spans = shotSpans(layer, scene.frames, comp.fps);
  // one reference frame for each 3 s of the clip, as for a 2D film; the camera's own shots say what happens inside each window
  const count = Math.min(H3_LIMITS.maxFrames, Math.max(1, Math.round(durationSec / H3_LIMITS.secPerFrame)));
  const board = context.storyboard ?? [];
  const boardTotal = board.reduce((n, sc) => n + sc.durationSec, 0) || 1;
  const sizes = framings(director.scenes[scene.id]?.intent, spans.length);
  const seen = new Set<number>();
  const shots: PlannedShot[] = Array.from({ length: count }, (_, i) => {
    const from = (i / count) * scene.frames;
    const to = ((i + 1) / count) * scene.frames;
    const mid = (from + to) / 2;
    const inside = spans.flatMap((sp, k) => (sp[1] >= from && sp[0] <= to ? [k] : []));
    const home = spans.findIndex((sp) => mid >= sp[0] && mid <= sp[1]);
    let acc = 0;
    const idx = Math.max(0, board.findIndex((sc) => (acc += sc.durationSec) / boardTotal >= mid / scene.frames));
    const first = !seen.has(idx);
    seen.add(idx);
    const size = sizes[home] ? `${sizes[home]} shot` : '';
    const words = board.length ? squash(board[idx]?.intent ?? '') : '';
    const base = first ? sentence(words || 'the product on show', 320) : 'the same moment of the story, the motion carrying on';
    // the moves of every camera shot that falls in the window, in order, without repeats
    const all = [...new Set(inside.map((k) => cameraWords3d(layer, spans[k]!)))];
    const moves = all.length > 1 ? all.filter((m) => m !== 'locked-off camera') : all;
    return {
      sceneId: scene.id,
      localFrame: Math.floor(mid),
      intent: [size && `${size[0]!.toUpperCase()}${size.slice(1)}.`, base].filter(Boolean).join(' '),
      camera: moves.length ? moves.join(', then ') : 'gentle camera move',
      sec: durationSec / count,
      atSec: (scene.start + mid) / comp.fps,
    };
  });
  const elements = elementNames(comp, scene.id);
  return {
    aspect: aspectOf(comp.width, comp.height),
    filmSec: r1(filmSec),
    durationSec,
    shots,
    skipped: [],
    stage3d: true,
    ...(elements ? { elements } : {}),
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
  const name = plan.context.productName ?? (plan.stage3d ? plan.context.title : undefined);
  const noun = subject ? `${/^[aeiou]/i.test(subject) ? 'an' : 'a'} ${subject}` : '';
  if (name || noun) lines.push(`Subject: ${name ? `${name}${noun ? `, ${noun}` : ''}` : noun}.`);
  if (style?.productLine) lines.push(`Hero: ${cut(squash(style.productLine), 160)}.`);
  const look = [style?.mood, style?.light].filter(Boolean).map((x) => squash(x!));
  if (look.length) lines.push(`Look: ${cut(look.join('; '), 220)}.`);
  if (plan.context.concept) lines.push(`Story: ${plan.context.concept.replace(/\.+$/, '')}.`);
  const beats = (plan.context.storyboard ?? []).map((sc) => sc.intent.replace(/\.+$/, '')).filter(Boolean);
  if (plan.stage3d && beats.length && level < 2) lines.push(`How it unfolds: ${beats.map((x, i) => `${i + 1}) ${x}`).join('; ')}.`);
  if (plan.elements) lines.push(`Also in the set: ${plan.elements}, moving through the shots.`);
  if (level < 2 && brief) lines.push(`Brief: ${cut(brief, 450)}`);
  if (level < 1 && transcript) lines.push(`Notes from the chat with the director: ${cut(transcript.slice(-700), 600)}`);
  return lines;
}

/** One prompt for the whole clip: what the film is, then the shots in order, each tied to its reference picture, and what must not appear. */
export function buildAiFilmPrompt(plan: AiFilmPlan): string {
  const sec = plan.durationSec / (plan.shots.length || 1);
  const even = plan.shots.every((sh) => Math.abs(sh.sec - sec) < 0.05);
  let t = 0;
  const shots = plan.shots.map((shot, i) => {
    const from = t;
    t += shot.sec;
    const to = i === plan.shots.length - 1 ? plan.durationSec : t;
    return `Shot ${i + 1} (${clock(from)}-${clock(to)}), Image ${i + 1}: ${shot.intent.replace(/\.+$/, '')}. Camera: ${shot.camera}.`;
  });
  const build = (level: number): string =>
    [
      `One continuous cinematic commercial, ${plan.aspect} frame, ${plan.durationSec} seconds, ${plan.shots.length} reference images in time order${even ? `, one per ${r1(sec)} seconds` : ', each held for the time its shot gives'}: follow them image by image, in sequence, with smooth cuts.`,
      ...contextLines(plan, level),
      ...(plan.stage3d ? [`Every reference image is a frame of one finished 3D film. Make that same film again, richer: the same story in the same order, the same product, set, light and colour grade, the same camera moves. Add depth, natural motion, fluid and cloth physics, real reflections and soft light, and invent no new objects, scenes or story.`] : []),
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

/** Draws a composition at the given seconds as pictures: the headless stage. */
export type Render3d = (comp: Comp, times: number[]) => Promise<Buffer[]>;

/** The reference pictures, one per planned shot, as JPEGs: a 2D scene's pictures flattened where the film is at that moment, or the 3D stage's own render. */
export async function captureFrames(ctx: Pick<ToolCtx, 'assets'>, comp: Comp, plan: AiFilmPlan, render3d?: Render3d): Promise<Buffer[]> {
  if (plan.stage3d) {
    if (!render3d) throw new Error('a 3D film needs the stage to draw its frames');
    const drawn = await render3d(withoutTitles(comp), plan.shots.map((sh) => sh.atSec ?? 0));
    if (drawn.length !== plan.shots.length) throw new Error('the stage drew fewer frames than the movie needs');
    return Promise.all(drawn.map((png) => sharp(png).resize({ width: FRAME_LONG_SIDE, height: FRAME_LONG_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()));
  }
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
