import type { Aspect } from '@shared/composition';
import { storyboardSchema, type Scene, type Storyboard } from '@shared/storyboard';
import type { Beat, CinematicBoard } from '../../authoring/beatsheet';

/** The first '<n>s', '<n> s', '<n> sec' or '<n> seconds' in the text, 4 to 20 inclusive. */
export function secondsIn(text: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 4 && n <= 20 ? n : undefined;
}

/** The length of the film the brief asks for, at most 10 s (the 3D film's limit), 8 s when it names none. */
export const askedSeconds = (text: string): number => Math.min(10, secondsIn(text) ?? 8);

const SHOT_TYPE: Record<NonNullable<Beat['phase']>, Scene['shotType']> = { hook: 'hero', build: 'detail', peak: 'lifestyle', reveal: 'reveal', close: 'closer' };
const CAMERA: Record<Beat['move'], Scene['camera']> = { push: 'dolly-in', pull: 'dolly-in', 'dolly-zoom': 'dolly-in', orbit: 'orbit', truck: 'pan', crane: 'parallax', hold: 'static', whip: 'static', rack: 'static' };

const MIN_SCENE = 2;
const MAX_SCENE = 8;
const MAX_SCENES = 6;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Consecutive beats grouped into scenes of 2 to 8 s (and at most 6 scenes), a short last group joining the one before. */
function groupBeats(beats: readonly Beat[]): Beat[][] {
  const total = beats.reduce((s, b) => s + b.seconds, 0);
  const target = Math.min(MAX_SCENE - 2, Math.max(MIN_SCENE, total / MAX_SCENES));
  const groups: Beat[][] = [];
  let cur: Beat[] = [];
  let sum = 0;
  for (const b of beats) {
    cur.push(b);
    sum += b.seconds;
    if (sum >= target) {
      groups.push(cur);
      cur = [];
      sum = 0;
    }
  }
  if (cur.length) {
    if (sum < MIN_SCENE && groups.length) groups[groups.length - 1]!.push(...cur);
    else groups.push(cur);
  }
  return groups;
}

const hexes = (board: CinematicBoard): string[] => {
  const p = board.set?.palette;
  const all = [p?.top, p?.horizon, p?.ground, board.endCard?.accent, board.light?.key, board.light?.rim].filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
  return all.length ? [...new Set(all)].slice(0, 6) : ['#111111'];
};

/** The plan panel's storyboard for a 3D film, made from Muse's board: every scene is a run of the board's shots. */
export function storyboardFromBoard(board: CinematicBoard, o: { title: string; aspect: Aspect }): Storyboard {
  const scenes: Scene[] = groupBeats(board.sheet.beats).map((g, i) => {
    const first = g[0]!;
    const notes = g.map((b) => b.note?.trim()).filter((n): n is string => !!n);
    const words = g.map((b) => b.text?.trim()).filter((t): t is string => !!t);
    const intent = (notes.length ? notes.join('; ') : words.length ? words.join(' / ') : `${first.size} ${first.move}`).slice(0, 300);
    const text = g.find((b) => b.text?.trim())?.text?.trim();
    const seconds = Math.min(MAX_SCENE, Math.max(MIN_SCENE, round1(g.reduce((s, b) => s + b.seconds, 0))));
    return {
      id: `shot-${i + 1}`,
      durationSec: seconds,
      intent,
      shotType: first.phase ? SHOT_TYPE[first.phase] : 'detail',
      camera: CAMERA[first.move],
      layersWanted: ['bg', 'product'],
      ...(text ? { text: text.slice(0, 120) } : {}),
      mode: '3d',
      modeReason: 'one 3D film',
    };
  });
  const durationSec = round1(board.sheet.beats.reduce((s, b) => s + b.seconds, 0));
  return storyboardSchema.parse({ title: o.title.slice(0, 80) || 'Film', aspect: o.aspect, durationSec, palette: hexes(board), scenes });
}
