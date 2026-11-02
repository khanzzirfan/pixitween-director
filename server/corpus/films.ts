// Reference films in the corpus: measured per shot from frames sampled at 25 fps (debug/movies/_tools/analyze.py), reviewed by eye from contact sheets.
// The committed snapshots (docs/direction/corpus/films/<slug>.json) are the source of truth; the DB rows and the lessons derived from them can be rebuilt.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/open';
import { tx } from '../db/open';
import { addEntry } from './store';

export const FILMS_DIR = 'docs/direction/corpus/films';
export const STATS_SOURCE = 'films:stats';

export interface ReviewBeat {
  t: string;
  beat: string;
  note: string;
}
export interface ShotLabel {
  shot: number;
  scale: string;
  beat: string;
  note: string;
}
export interface FilmReview {
  kind: string;
  subject: string;
  summary: string;
  beats: ReviewBeat[];
  shot_labels: ShotLabel[];
  learn: string[];
}
export interface ShotRow {
  idx: number;
  start_s: number;
  end_s: number;
  dur_s: number;
  enters_via: string;
  move: string;
  ease: string;
  zoom_pct: number;
  pan_pct: number;
  tilt_pct: number;
  jitter: number;
  luma: number;
  contrast: number;
  saturation: number;
  warmth: number;
  key_style: string;
  temperature: string;
  hue: string;
  dof_ratio: number;
}
export interface FilmSnapshot {
  slug: string;
  title: string;
  fps: number;
  width: number;
  height: number;
  duration_s: number;
  frames: number;
  arc: unknown;
  moves: Record<string, number>;
  review: FilmReview | null;
  shots: ShotRow[];
}

type Json = any; // the analyzer's output is wide and untyped; only the fields read below matter

const readJson = (file: string): Json => JSON.parse(readFileSync(file, 'utf8'));
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** The review of a film: review.json when there is one, else the older hand review kept inside learning.json. */
function reviewOf(dir: string, learning: Json): FilmReview | null {
  const file = join(dir, 'review.json');
  if (existsSync(file)) return readJson(file) as FilmReview;
  const r = learning.review;
  if (!r) return null;
  return {
    kind: /2D/i.test(r.what ?? '') ? '2d-motion-graphic' : 'product-ad',
    subject: String(r.what ?? '').slice(0, 120),
    summary: String(r.what ?? ''),
    beats: (r.arc ?? []).map((a: Json) => ({ t: a.t, beat: a.beat, note: a.note })),
    shot_labels: [],
    learn: r.learn ?? [],
  };
}

/** Compact snapshot of one analysed film folder (learning.json + shots.json + review). */
export function snapshotFilm(dir: string): FilmSnapshot {
  const learning = readJson(join(dir, 'learning.json'));
  const shots = readJson(join(dir, 'shots.json')) as Json[];
  return {
    slug: learning.slug,
    title: String(learning.source ?? learning.slug).replace(/^From Klickpin\.com-\s*/, '').replace(/\.mp4$/, ''),
    fps: learning.extract_fps,
    width: learning.video?.width ?? 0,
    height: learning.video?.height ?? 0,
    duration_s: learning.duration_s,
    frames: learning.frames_extracted,
    arc: learning.arc,
    moves: learning.camera_moves_by_shot_count ?? {},
    review: reviewOf(dir, learning),
    shots: shots.map((s) => ({
      idx: s.shot,
      start_s: s.start_s,
      end_s: s.end_s,
      dur_s: s.duration_s,
      enters_via: s.enters_via ?? 'start',
      move: s.camera?.move ?? 'static',
      ease: s.camera?.ease ?? 'none',
      zoom_pct: s.camera?.total_zoom_centre_pct ?? 0,
      pan_pct: s.camera?.total_pan_x_pct ?? 0,
      tilt_pct: s.camera?.total_tilt_y_pct ?? 0,
      jitter: s.camera?.mean_jitter ?? 0,
      luma: s.light?.luma_mean ?? 0,
      contrast: s.light?.contrast_std ?? 0,
      saturation: s.colour?.saturation ?? 0,
      warmth: s.colour?.warmth_r_over_b ?? 1,
      key_style: s.light?.style ?? 'mid-key',
      temperature: s.colour?.temperature ?? 'neutral',
      hue: s.colour?.dominant_hue ?? 'neutral',
      dof_ratio: s.focus?.dof_ratio ?? 0,
    })),
  };
}

/** Write a snapshot per analysed film folder under `moviesDir` into `outDir`. Returns the slugs written. */
export function writeSnapshots(moviesDir: string, outDir = FILMS_DIR): string[] {
  mkdirSync(outDir, { recursive: true });
  const slugs: string[] = [];
  for (const name of readdirSync(moviesDir).sort()) {
    const dir = join(moviesDir, name);
    if (!existsSync(join(dir, 'learning.json')) || !existsSync(join(dir, 'shots.json'))) continue;
    const snap = snapshotFilm(dir);
    writeFileSync(join(outDir, `${snap.slug}.json`), JSON.stringify(snap) + '\n');
    slugs.push(snap.slug);
  }
  return slugs;
}

export function readSnapshots(dir = FILMS_DIR): FilmSnapshot[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(join(dir, f)) as FilmSnapshot);
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** Put films and their shots in (replacing a film that is already there). Returns how many films. */
export function ingestFilms(db: Db, films: FilmSnapshot[]): number {
  const film = db.prepare(
    `INSERT OR REPLACE INTO corpus_films (slug, title, fps, width, height, duration_s, frames, shots, avg_shot_s, median_shot_s, cuts_per_10s, hold_s, hold_ratio,
       kind, summary, arc_json, review_json, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const shot = db.prepare(
    `INSERT INTO corpus_shots (film_slug, idx, start_s, end_s, dur_s, enters_via, move, ease, zoom_pct, pan_pct, tilt_pct, jitter, luma, contrast, saturation,
       warmth, key_style, temperature, hue, dof_ratio, scale, beat, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const at = new Date().toISOString();
  tx(db, () => {
    for (const f of films) {
      db.prepare('DELETE FROM corpus_shots WHERE film_slug = ?').run(f.slug);
      const durs = f.shots.map((s) => s.dur_s);
      const hold = durs.at(-1) ?? 0;
      film.run(
        f.slug, f.title, f.fps, f.width, f.height, f.duration_s, f.frames, f.shots.length, round(mean(durs)), round(median(durs)),
        round((Math.max(0, f.shots.length - 1) / Math.max(f.duration_s, 0.01)) * 10, 2), hold, round(hold / Math.max(f.duration_s, 0.01)),
        f.review?.kind ?? '', f.review?.summary ?? '', JSON.stringify({ arc: f.arc, moves: f.moves }), f.review ? JSON.stringify(f.review) : null, at,
      );
      const labels = new Map((f.review?.shot_labels ?? []).map((l) => [l.shot, l]));
      for (const s of f.shots) {
        const l = labels.get(s.idx);
        shot.run(
          f.slug, s.idx, s.start_s, s.end_s, s.dur_s, s.enters_via, s.move, s.ease, s.zoom_pct, s.pan_pct, s.tilt_pct, s.jitter, s.luma, s.contrast,
          s.saturation, s.warmth, s.key_style, s.temperature, s.hue, s.dof_ratio, l?.scale ?? null, l?.beat ?? null, l?.note ?? null,
        );
      }
    }
  });
  return films.length;
}

/** The main move of a shot, from the analyzer's tags ("push-in + pan right ..."). */
export function mainMove(move: string): 'push-in' | 'pull-out' | 'pan' | 'tilt' | 'static' {
  const m = move.toLowerCase();
  if (m.includes('push-in')) return 'push-in';
  if (m.includes('pull-out')) return 'pull-out';
  if (m.includes('pan')) return 'pan';
  if (m.includes('tilt')) return 'tilt';
  return 'static';
}

interface FilmRow {
  slug: string;
  kind: string;
  duration_s: number;
  shots: number;
  avg_shot_s: number;
  median_shot_s: number;
  cuts_per_10s: number;
  hold_s: number;
  hold_ratio: number;
}
interface ShotDb extends ShotRow {
  film_slug: string;
  scale: string | null;
}

/**
 * Cross-film lessons, measured. Rebuilt every time (the old ones from this source go first) so the numbers always match the films in the table.
 * Only edited films with at least three shots count towards pacing; reels and tutorials are counted separately from the ads.
 */
export function deriveLessons(db: Db): number {
  const films = db.prepare('SELECT slug, kind, duration_s, shots, avg_shot_s, median_shot_s, cuts_per_10s, hold_s, hold_ratio FROM corpus_films').all() as unknown as FilmRow[];
  const allShots = db.prepare('SELECT * FROM corpus_shots ORDER BY film_slug, idx').all() as unknown as ShotDb[];
  const isAd = (f: FilmRow) => f.kind === 'product-ad' || f.kind === '2d-motion-graphic';
  let pool = films.filter((f) => isAd(f) && f.shots >= 3);
  if (pool.length < 5) pool = films.filter((f) => f.shots >= 3);
  if (pool.length < 3) return 0;
  const slugs = new Set(pool.map((f) => f.slug));
  const shots = allShots.filter((s) => slugs.has(s.film_slug));
  const by = new Map<string, ShotDb[]>();
  for (const s of shots) by.set(s.film_slug, [...(by.get(s.film_slug) ?? []), s]);
  const n = pool.length;
  const lessons: { topic: string; text: string; weight: number }[] = [];

  const med = median(pool.map((f) => f.median_shot_s));
  lessons.push({
    topic: 'reference-pace',
    weight: 2,
    text: `Across ${n} reference films the median shot is ${med.toFixed(1)} s (middle half of films: ${quantile(pool.map((f) => f.median_shot_s), 0.25).toFixed(1)}-${quantile(pool.map((f) => f.median_shot_s), 0.75).toFixed(1)} s) and the cut rate is ${median(pool.map((f) => f.cuts_per_10s)).toFixed(1)} per 10 s. A shot longer than ${quantile(pool.map((f) => f.median_shot_s), 0.75).toFixed(1)} s needs a reason such as a claim or the end hold.`,
  });

  const first = pool.map((f) => by.get(f.slug)![0]!.dur_s);
  lessons.push({
    topic: 'reference-pace',
    weight: 1.5,
    text: `The opening shot is ${median(first).toFixed(1)} s at the median, and ${pct(first.filter((d) => d <= 1.5).length, n)}% of films open on a shot of 1.5 s or less. Open on the most kinetic frame, not on a title.`,
  });

  const accel = pool.filter((f) => f.shots >= 6).map((f) => {
    const d = by.get(f.slug)!.slice(0, -1).map((s) => s.dur_s);
    const h = d.length >> 1;
    return mean(d.slice(h)) < mean(d.slice(0, h));
  });
  if (accel.length >= 3) {
    const up = pct(accel.filter(Boolean).length, accel.length);
    lessons.push({
      topic: 'reference-pace',
      weight: 1,
      text: `${up}% of films with six or more shots cut faster in the second half than in the first (before the last shot). ${up >= 60 ? 'Let the rhythm tighten, then stop.' : 'Acceleration is not a rule here: hold a steady rhythm and vary single shot lengths instead.'}`,
    });
  }

  const hold = pool.map((f) => f.hold_s);
  const ratio = pool.map((f) => f.hold_ratio);
  lessons.push({
    topic: 'reference-pace',
    weight: 2,
    text: `The last shot holds ${median(hold).toFixed(1)} s at the median, ${Math.round(median(ratio) * 100)}% of the runtime (middle half ${Math.round(quantile(ratio, 0.25) * 100)}-${Math.round(quantile(ratio, 0.75) * 100)}%). ${pct(ratio.filter((r) => r >= 0.12).length, n)}% of films hold at least 12%.`,
  });

  const moves = shots.map((s) => mainMove(s.move));
  const count = (m: string) => moves.filter((x) => x === m).length;
  const push = shots.filter((s) => mainMove(s.move) === 'push-in');
  const pushSize = push.map((s) => Math.abs(s.zoom_pct));
  lessons.push({
    topic: 'reference-camera',
    weight: 2,
    text: `Camera moves over ${shots.length} shots: ${pct(count('push-in'), shots.length)}% push-in, ${pct(count('pull-out'), shots.length)}% pull-out, ${pct(count('pan') + count('tilt'), shots.length)}% pan or tilt, ${pct(count('static'), shots.length)}% still. A push-in is the default; its median size is ${median(pushSize).toFixed(0)}% (middle half ${quantile(pushSize, 0.25).toFixed(0)}-${quantile(pushSize, 0.75).toFixed(0)}%).`,
  });

  const eases = new Map<string, number>();
  for (const s of shots.filter((s) => mainMove(s.move) !== 'static')) eases.set(s.ease, (eases.get(s.ease) ?? 0) + 1);
  const moving = [...eases.values()].reduce((a, b) => a + b, 0);
  if (moving >= 10)
    lessons.push({
      topic: 'reference-camera',
      weight: 1,
      text: `Eases on moving shots: ${[...eases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, c]) => `${pct(c, moving)}% ${e}`).join(', ')}.`,
    });

  const enters = (k: string) => shots.filter((s) => s.idx > 1 && s.enters_via === k).length;
  const entered = shots.filter((s) => s.idx > 1).length;
  lessons.push({
    topic: 'reference-edit',
    weight: 1,
    text: `${pct(enters('hard'), entered)}% of cuts are hard cuts and ${pct(enters('soft'), entered)}% are soft (dissolve, morph or whip). Default to a hard cut; save the soft ones for a change of act.`,
  });

  const key = (k: string) => shots.filter((s) => s.key_style === k).length;
  const warm = shots.filter((s) => s.temperature === 'warm').length;
  const cool = shots.filter((s) => s.temperature === 'cool').length;
  lessons.push({
    topic: 'reference-light',
    weight: 1,
    text: `Light: ${pct(key('low-key'), shots.length)}% low-key, ${pct(key('mid-key'), shots.length)}% mid-key, ${pct(key('high-key'), shots.length)}% high-key; ${pct(warm, shots.length)}% warm, ${pct(cool, shots.length)}% cool. Median shot contrast ${median(shots.map((s) => s.contrast)).toFixed(2)}, saturation ${median(shots.map((s) => s.saturation)).toFixed(2)}.`,
  });

  let same = 0;
  let pairs = 0;
  for (const list of by.values())
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1]!.scale, list[i]!.scale];
      if (a && b) {
        pairs++;
        if (a === b) same++;
      }
    }
  if (pairs >= 20)
    lessons.push({
      topic: 'reference-edit',
      weight: 1.5,
      text: `In reviewed films ${pct(same, pairs)}% of consecutive shots keep the same size (wide, medium, close, macro). Change the size on ${100 - pct(same, pairs)}% of cuts; avoid three in a row at one size.`,
    });

  tx(db, () => {
    db.prepare('DELETE FROM corpus_entries WHERE source = ?').run(STATS_SOURCE);
    for (const l of lessons) addEntry(db, { ...l, source: STATS_SOURCE, scope: 'all' });
  });
  return lessons.length;
}

/** Each film's reviewed take-aways as entries, one source per film. Returns how many are in the table for films. */
export function ingestFilmLessons(db: Db, films: FilmSnapshot[]): number {
  let added = 0;
  tx(db, () => {
    for (const f of films) {
      const source = `film:${f.slug}`;
      db.prepare('DELETE FROM corpus_entries WHERE source = ?').run(source);
      for (const text of f.review?.learn ?? []) {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean.length >= 30) {
          addEntry(db, { topic: 'reference-films', text: clean.slice(0, 400), source, scope: 'all' });
          added++;
        }
      }
    }
  });
  return added;
}

const loaded = new WeakSet<Db>();

/** Everything above, once per connection: films from the committed snapshots, then their lessons. Quiet when there are no snapshots. */
export function ingestAllFilms(db: Db, dir = FILMS_DIR): { films: number; lessons: number } {
  const films = readSnapshots(dir);
  if (!films.length) return { films: 0, lessons: 0 };
  ingestFilms(db, films);
  return { films: films.length, lessons: deriveLessons(db) + ingestFilmLessons(db, films) };
}

/** As `ingestAllFilms`, but only the first call on a connection does the work. */
export function ensureFilms(db: Db, dir = FILMS_DIR): void {
  if (loaded.has(db)) return;
  loaded.add(db);
  const have = (db.prepare('SELECT COUNT(*) AS n FROM corpus_films').get() as { n: number }).n;
  if (have === 0) ingestAllFilms(db, dir);
}
