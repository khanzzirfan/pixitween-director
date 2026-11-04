import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open';
import { addEntry, corpusFor, ingestDocs, parseLessons, lessonsBlock, outcomeReport, recordOutcome, seedCorpus, setWeight } from './store';

describe('corpus', () => {
  it('seeds the craft rules once', () => {
    const db = openDatabase(':memory:');
    expect(seedCorpus(db)).toBeGreaterThan(5);
    expect(seedCorpus(db)).toBe(0);
  });

  it('shows general entries plus those for the brief category, heaviest first, limited', () => {
    const db = openDatabase(':memory:');
    const mug = addEntry(db, { topic: 'look', category: 'mug', text: 'Steam sells a mug.', source: 'test', weight: 9 });
    addEntry(db, { topic: 'look', category: 'sneaker', text: 'Motion sells a sneaker.', source: 'test', weight: 9 });
    const got = corpusFor(db, 'A ceramic Mug. Price 12.', 3);
    expect(got.map((e) => e.id)[0]).toBe(mug);
    expect(got).toHaveLength(3);
    expect(got.some((e) => e.category === 'sneaker')).toBe(false);
    expect(lessonsBlock(got)).toContain('Steam sells a mug.');
    expect(lessonsBlock([])).toBe('');
  });

  it('a weight of 0 hides an entry', () => {
    const db = openDatabase(':memory:');
    const [first] = corpusFor(db, 'anything', 1);
    setWeight(db, first!.id, 0);
    expect(corpusFor(db, 'anything', 50).some((e) => e.id === first!.id)).toBe(false);
  });

  it('reports films, ready rate and cost per entry', () => {
    const db = openDatabase(':memory:');
    const [a, b] = corpusFor(db, 'x', 2);
    recordOutcome(db, { filmId: 'film_aaaaaaaaaaaa', briefText: 'x', entryIds: [a!.id, b!.id], status: 'ready', costUsd: 1 });
    recordOutcome(db, { filmId: 'film_bbbbbbbbbbbb', briefText: 'x', entryIds: [a!.id], status: 'failed', costUsd: 3 });
    const r = Object.fromEntries(outcomeReport(db).map((x) => [x.id, x]));
    expect(r[a!.id]).toMatchObject({ films: 2, ready: 1, avgCostUsd: 2 });
    expect(r[b!.id]).toMatchObject({ films: 1, ready: 1 });
  });

  it('parses bullets, numbered lists and numbered table rows, drops short lines', () => {
    const md = [
      '# T',
      '| # | Law | Why |',
      '|---|---|---|',
      '| 1 | **One claim per clip.** Say what the viewer repeats. | why |',
      '- Centred is correct in 9:16 for a single subject.',
      '3. **Overlap motion across the cut.** Something moves on both sides.',
      '- short',
    ].join('\n');
    expect(parseLessons(md)).toEqual([
      { text: 'One claim per clip. Say what the viewer repeats.', n: 1 },
      { text: 'Centred is correct in 9:16 for a single subject.' },
      { text: 'Overlap motion across the cut. Something moves on both sides.', n: 3 },
    ]);
  });

  it('keeps the retail-only laws away from the crew, and the laws that hold for any film', () => {
    const db = openDatabase(':memory:');
    const shown = corpusFor(db, 'x', 500).map((e) => e.text);
    expect(shown.some((t) => /product never turns/i.test(t))).toBe(false);
    expect(shown.some((t) => /one dominant move/i.test(t))).toBe(false);
    expect(shown.some((t) => /^Composite the real product/.test(t))).toBe(true);
    expect(corpusFor(db, 'x', 500, '', 'retail').some((t) => /one dominant move/i.test(t.text))).toBe(true);
  });

  it('the five are a mix of topics, not five ad laws', () => {
    const db = openDatabase(':memory:');
    for (const seed of ['film_a', 'film_b', 'film_c']) expect(new Set(corpusFor(db, 'x', 5, seed).map((e) => e.topic)).size).toBeGreaterThanOrEqual(3);
  });

  it('ingests the real corpus documents once', () => {
    const db = openDatabase(':memory:');
    expect(ingestDocs(db)).toBeGreaterThan(20);
    expect(ingestDocs(db)).toBe(0);
  });

  it('picks the same lessons for one film and different ones across films', () => {
    const db = openDatabase(':memory:');
    const ids = (seed: string) =>
      corpusFor(db, 'x', 5, seed)
        .map((e) => e.id)
        .join();
    expect(ids('film_a')).toBe(ids('film_a'));
    expect(new Set(['film_a', 'film_b', 'film_c', 'film_d'].map(ids)).size).toBeGreaterThan(1);
  });
});
