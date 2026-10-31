// The critic: after a cinematic film is built, Muse (Spark vision) looks at frames of the film itself and grades it against a rubric. Its fixes
// are edits to the BOARD (a shot's angle, size, move, product move, cut or length; the light), never to the film, and go through the same
// checker as the planner's boards (reviewBoard), so a fix that breaks a rule is refused. The point: a decision on the board must reach the pixels.
import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ToolCtx } from '@shared/tools';
import { ANGLES, CUTS, KEY_LEVELS, MOVES, PRODUCT_MOVES, SHOT_SIZES, TONES, reviewBoard, totalSeconds, type CinematicBoard } from './beatsheet';

export const CRITERIA = ['product', 'idea', 'peak', 'light', 'price', 'variety'] as const;
export type Criterion = (typeof CRITERIA)[number];
/** What each criterion asks of the frames; written into the prompt. */
export const CRITERIA_HELP: Record<Criterion, string> = {
  product: 'the product is clearly visible and recognisable in most frames, never hidden behind a world element or cut off by accident',
  idea: 'the concept on the board can be seen in the frames (its elements are on screen and do what the shots say)',
  peak: 'one frame is clearly the strongest: the most dramatic framing, with the product and an element both readable',
  light: 'the light matches the tone and key on the board (colour of the key light, dark or bright field) and the product is lit, not lost',
  price: 'the last frame shows the title and price legibly, on a calm frame with nothing crossing them',
  variety: 'neighbouring frames look different (size, height, angle); no two shots in a row look the same',
};
/** A mean score at or above this, with no criterion under MIN_EACH, passes. Scores run 1 (bad) to 5 (excellent). */
export const PASS_MEAN = 3.5;
export const MIN_EACH = 3;
export const CRITIC_CALL_USD = 0.005;
export const MAX_FIXES = 4;

const SHOT_FIELDS = { angle: ANGLES, size: SHOT_SIZES, move: MOVES, product: PRODUCT_MOVES, cut: CUTS } as const;
export type ShotField = keyof typeof SHOT_FIELDS | 'seconds';

/** Frame times for a sheet: the middle of each shot, the last one a little before the end so the price card is settled. */
export function frameTimes(board: CinematicBoard): number[] {
  let at = 0;
  const times = board.sheet.beats.map((b) => {
    const t = at + b.seconds / 2;
    at += b.seconds;
    return Math.round(t * 100) / 100;
  });
  if (times.length) times[times.length - 1] = Math.round((totalSeconds(board.sheet) - 0.1) * 100) / 100;
  return times;
}

export function criticPrompt(board: CinematicBoard, times: number[]): string {
  const shots = board.sheet.beats.map((b, i) => `${i + 1}. ${b.seconds}s ${b.size} ${b.move} angle=${b.angle ?? 'eye'} product=${b.product ?? 'still'} cut=${b.cut ?? 'hard'}${b.phase ? ` phase=${b.phase}` : ''}${b.note ? ` - ${b.note}` : ''}`);
  return [
    'You are the editor of a short photoreal 3D product ad. You are shown one frame from each shot, in order, at the times given. Grade the FILM from these frames against the board it was made from.',
    `Concept: ${board.concept}. Mood: ${board.mood}. Light: tone ${board.tone ?? 'default'}, key ${board.key ?? 'mid'}.`,
    `Elements: ${board.elements.map((e) => e.name).join(', ')}.`,
    'Shots (one frame each, in this order):',
    ...shots.map((s, i) => `${s} [frame ${i + 1} at ${times[i] ?? '?'} s]`),
    'Score each from 1 (bad) to 5 (excellent):',
    ...CRITERIA.map((c) => `- ${c}: ${CRITERIA_HELP[c]}`),
    'Then list issues (at most 6): each names the shot number it is seen in, the criterion, and what you SEE in that frame (evidence, not a guess).',
    `Then propose at most ${MAX_FIXES} fixes as edits to ONE shot of the board each: {"shot": number, "field": one of ${[...Object.keys(SHOT_FIELDS), 'seconds'].join(', ')}, "value": ...}. Allowed values: ${Object.entries(SHOT_FIELDS).map(([k, v]) => `${k}: ${v.join('|')}`).join('; ')}; seconds: a number 0.4-2.5. You may also change the light with {"shot": 0, "field": "tone", "value": ${TONES.join('|')}} or "key" (${KEY_LEVELS.join('|')}). Only fix what you can see is wrong.`,
    'Reply with JSON only: {"scores":{"product":n,"idea":n,"peak":n,"light":n,"price":n,"variety":n},"issues":[{"shot":n,"criterion":"...","evidence":"..."}],"fixes":[{"shot":n,"field":"...","value":...,"why":"..."}]}',
  ].join('\n');
}

const fixSchema = z.object({ shot: z.number().int(), field: z.string(), value: z.union([z.string(), z.number()]), why: z.string().max(200).optional() });
const critiqueSchema = z.object({
  scores: z.record(z.string(), z.number().min(1).max(5)),
  issues: z.array(z.object({ shot: z.number().int(), criterion: z.string(), evidence: z.string() })).max(12).default([]),
  fixes: z.array(fixSchema).max(12).default([]),
});

export interface Fix {
  shot: number;
  field: ShotField | 'tone' | 'key';
  value: string | number;
  why?: string;
}
export interface Critique {
  scores: Record<Criterion, number>;
  mean: number;
  pass: boolean;
  issues: Array<{ shot: number; criterion: string; evidence: string }>;
  fixes: Fix[];
  /** Fixes that named a shot or value the board cannot take. */
  dropped: string[];
}

/** The critique in a Spark reply (an object or JSON text), with ungrounded issues and fixes removed, or why it could not be read. */
export function parseCritique(raw: unknown, board: CinematicBoard): { ok: true; critique: Critique } | { ok: false; reason: string } {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    } catch {
      return { ok: false, reason: 'not JSON' };
    }
  }
  const p = critiqueSchema.safeParse(v);
  if (!p.success) return { ok: false, reason: p.error.issues[0]?.message ?? 'wrong shape' };
  const scores = {} as Record<Criterion, number>;
  for (const c of CRITERIA) {
    const s = p.data.scores[c];
    if (s === undefined) return { ok: false, reason: `no score for ${c}` };
    scores[c] = s;
  }
  const n = board.sheet.beats.length;
  const dropped: string[] = [];
  const fixes: Fix[] = [];
  for (const f of p.data.fixes) {
    const name = `shot ${f.shot} ${f.field}=${f.value}`;
    if (f.field === 'tone' || f.field === 'key') {
      const ok = (f.field === 'tone' ? TONES : KEY_LEVELS).includes(String(f.value) as never);
      if (ok) fixes.push({ ...f, field: f.field });
      else dropped.push(`${name}: not a ${f.field}`);
    } else if (f.field === 'seconds') {
      if (f.shot >= 1 && f.shot <= n && typeof f.value === 'number' && f.value >= 0.4 && f.value <= 2.5) fixes.push({ ...f, field: 'seconds' });
      else dropped.push(`${name}: not a shot or not 0.4-2.5`);
    } else if (f.field in SHOT_FIELDS) {
      const allowed = SHOT_FIELDS[f.field as keyof typeof SHOT_FIELDS] as readonly string[];
      if (f.shot >= 1 && f.shot <= n && allowed.includes(String(f.value))) fixes.push({ ...f, field: f.field as ShotField });
      else dropped.push(`${name}: not a shot or not one of ${allowed.join('|')}`);
    } else dropped.push(`${name}: unknown field`);
  }
  const mean = Math.round((CRITERIA.reduce((s, c) => s + scores[c], 0) / CRITERIA.length) * 100) / 100;
  const issues = p.data.issues.filter((i) => i.shot >= 1 && i.shot <= n && i.evidence.length >= 12);
  return { ok: true, critique: { scores, mean, pass: mean >= PASS_MEAN && CRITERIA.every((c) => scores[c] >= MIN_EACH), issues, fixes: fixes.slice(0, MAX_FIXES), dropped } };
}

/** Applies the fixes one at a time, keeping each that leaves the board passing the checker; the rest come back as refused with the rules they broke. */
export function applyFixes(board: CinematicBoard, fixes: readonly Fix[]): { board: CinematicBoard; applied: Fix[]; refused: Array<{ fix: Fix; because: string[] }> } {
  let cur = board;
  const applied: Fix[] = [];
  const refused: Array<{ fix: Fix; because: string[] }> = [];
  for (const f of fixes) {
    const next: CinematicBoard =
      f.field === 'tone' || f.field === 'key'
        ? ({ ...cur, [f.field]: f.value } as CinematicBoard)
        : { ...cur, sheet: { beats: cur.sheet.beats.map((b, i) => (i === f.shot - 1 ? { ...b, [f.field]: f.value } : b)) } };
    const r = reviewBoard(next);
    if (r.violations.length) refused.push({ fix: f, because: r.violations });
    else {
      cur = r.board;
      applied.push(f);
    }
  }
  return { board: cur, applied, refused };
}

/** One Spark vision call over the frames. Throws when the reply cannot be read. */
export async function critiqueFilm(ctx: ToolCtx, o: { board: CinematicBoard; frames: Buffer[]; times: number[] }): Promise<Critique> {
  if (o.frames.length !== o.board.sheet.beats.length) throw new Error(`the critic needs one frame per shot (${o.board.sheet.beats.length}), got ${o.frames.length}`);
  const reply = await ctx.meta.spark.reviewImages(o.frames, criticPrompt(o.board, o.times));
  ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', `${o.frames.length} frames`, CRITIC_CALL_USD);
  const parsed = parseCritique(reply, o.board);
  if (!parsed.ok) throw new Error(`the critic's reply could not be read: ${parsed.reason}`);
  return parsed.critique;
}
