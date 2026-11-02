import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open';
import { deriveLessons, ingestAllFilms, ingestFilms, mainMove, type FilmSnapshot, type ShotRow } from './films';

const shot = (idx: number, dur: number, move = 'push-in', over: Partial<ShotRow> = {}): ShotRow => ({
  idx, start_s: idx, end_s: idx + dur, dur_s: dur, enters_via: idx === 1 ? 'start' : 'hard', move, ease: 'easeOut (decelerating)', zoom_pct: 20, pan_pct: 0, tilt_pct: 0,
  jitter: 0.1, luma: 0.4, contrast: 0.2, saturation: 0.5, warmth: 1.2, key_style: 'mid-key', temperature: 'warm', hue: 'orange', dof_ratio: 3, ...over,
});
const film = (slug: string): FilmSnapshot => ({
  slug, title: slug, fps: 25, width: 720, height: 1280, duration_s: 10, frames: 250, arc: {}, moves: {},
  review: { kind: 'product-ad', subject: 's', summary: 'sum', beats: [], shot_labels: [{ shot: 1, scale: 'macro', beat: 'hook', note: 'n' }], learn: ['Open on the most kinetic frame, not a title card.'] },
  shots: [shot(1, 0.8), shot(2, 1.2), shot(3, 1, 'pull-out'), shot(4, 0.6), shot(5, 0.5), shot(6, 0.4), shot(7, 2, 'static')],
});

describe('reference films', () => {
  it('names the main move of a tag list', () => {
    expect(mainMove('push-in + pan right (content moves right)')).toBe('push-in');
    expect(mainMove('slow pull-out')).toBe('pull-out');
    expect(mainMove('static/slight float')).toBe('static');
  });

  it('stores films and shots, replacing on a second load', () => {
    const db = openDatabase(':memory:');
    ingestFilms(db, [film('a'), film('b')]);
    ingestFilms(db, [film('a')]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM corpus_shots WHERE film_slug = ?').get('a') as { n: number }).n).toBe(7);
    const row = db.prepare('SELECT hold_s, hold_ratio, shots FROM corpus_films WHERE slug = ?').get('a') as { hold_s: number; hold_ratio: number; shots: number };
    expect(row).toEqual({ hold_s: 2, hold_ratio: 0.2, shots: 7 });
    expect((db.prepare("SELECT scale FROM corpus_shots WHERE film_slug = 'a' AND idx = 1").get() as { scale: string }).scale).toBe('macro');
  });

  it('derives measured lessons once per source, however often it runs', () => {
    const db = openDatabase(':memory:');
    ingestFilms(db, [film('a'), film('b'), film('c')]);
    const n = deriveLessons(db);
    expect(n).toBeGreaterThanOrEqual(5);
    deriveLessons(db);
    const rows = db.prepare("SELECT text FROM corpus_entries WHERE source = 'films:stats'").all() as { text: string }[];
    expect(rows).toHaveLength(n);
    expect(rows.some((r) => /last shot holds 2\.0 s/.test(r.text))).toBe(true);
  });

  it('loads snapshots from a folder, with their reviewed lessons', () => {
    const dir = mkdtempSync(join(tmpdir(), 'films-'));
    for (const s of ['a', 'b', 'c']) writeFileSync(join(dir, `${s}.json`), JSON.stringify(film(s)));
    const db = openDatabase(':memory:');
    expect(ingestAllFilms(db, dir).films).toBe(3);
    expect((db.prepare("SELECT COUNT(*) AS n FROM corpus_entries WHERE source = 'film:a'").get() as { n: number }).n).toBe(1);
    expect(ingestAllFilms(openDatabase(':memory:'), join(dir, 'missing'))).toEqual({ films: 0, lessons: 0 });
  });
});
