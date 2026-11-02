// The learned corpus: craft lessons the crew is shown at the start of a film, and a record of how each film that used them ended.
// Seeded from the reference deck; `weight` orders what is shown and can be changed by hand (setWeight). Nothing changes it automatically.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRAFT } from '../authoring/reference-deck';
import type { Db } from '../db/open';
import { tx } from '../db/open';
import { ensureFilms } from './films';

export interface CorpusEntry {
  id: string;
  topic: string;
  category: string;
  text: string;
  source: string;
  weight: number;
  scope: string;
}

const idOf = (source: string, text: string) => createHash('sha1').update(`${source}\n${text}`).digest('hex').slice(0, 16);

/** Add an entry once (same source and text is the same entry). Returns its id. */
export function addEntry(db: Db, e: { topic: string; category?: string; text: string; source: string; weight?: number; scope?: string }): string {
  const id = idOf(e.source, e.text);
  db.prepare('INSERT OR IGNORE INTO corpus_entries (id, topic, category, text, source, weight, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    e.topic,
    e.category ?? '*',
    e.text,
    e.source,
    e.weight ?? 1,
    e.scope ?? 'all',
    new Date().toISOString(),
  );
  return id;
}

/** Put the reference deck's craft rules in, once. */
export function seedCorpus(db: Db): number {
  const before = (db.prepare('SELECT COUNT(*) AS n FROM corpus_entries').get() as { n: number }).n;
  tx(db, () => {
    for (const line of CRAFT.split('\n- ')) addEntry(db, { topic: 'craft', text: line.trim(), source: 'reference-deck', scope: 'cinematic' });
  });
  return (db.prepare('SELECT COUNT(*) AS n FROM corpus_entries').get() as { n: number }).n - before;
}

/** The corpus documents that hold general lessons (looks and plate prompts are already code, in looks.ts). */
const DOCS = ['01-ad-laws', '04-motion-and-edit', '05-critic-rubric', '06-reference-films'];
export const CORPUS_DIR = 'docs/direction/corpus';

/** Lessons that argue with the crew's builders (the product turns and squashes, a shot may carry two moves), so they are for the retail clip only. */
const RETAIL_ONLY = /never (turns?|rotates?)|does not turn|stack two|one dominant move|squash/i;
/** Ad laws that hold for any film: one claim, the real product, no generated type, name the source. */
const LAWS_FOR_ALL = new Set([1, 2, 3, 8]);

export interface Lesson {
  text: string;
  /** The row or list number, when the line had one. */
  n?: number;
}

/** A lesson per bullet, per numbered list item and per numbered table row (its first cell), bold marks removed. */
export function parseLessons(markdown: string): Lesson[] {
  const out: Lesson[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    let text: string | undefined;
    let n: number | undefined;
    const item = /^(\d+)\.\s+(.*)/.exec(line);
    const row = /^\|\s*(\d+)\s*\|/.exec(line);
    if (line.startsWith('- ')) text = line.slice(2);
    else if (item) [n, text] = [Number(item[1]), item[2]];
    else if (row) [n, text] = [Number(row[1]), line.split('|')[2]];
    text = text?.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (text && text.length >= 30) out.push({ text: text.slice(0, 400), ...(n !== undefined ? { n } : {}) });
  }
  return out;
}

/** Where a lesson applies: by its document, then the retail-only wording wins. */
export function scopeOf(doc: string, lesson: Lesson): string {
  if (RETAIL_ONLY.test(lesson.text)) return 'retail';
  if (doc === '01-ad-laws') return lesson.n !== undefined && LAWS_FOR_ALL.has(lesson.n) ? 'all' : 'retail';
  if (doc === '05-critic-rubric') return 'retail';
  return 'all';
}

const ingested = new WeakSet<Db>();

/** Load the corpus documents' lessons, once per connection and once per lesson. Returns how many were new. */
export function ingestDocs(db: Db, dir = CORPUS_DIR): number {
  if (ingested.has(db)) return 0;
  ingested.add(db);
  const before = (db.prepare('SELECT COUNT(*) AS n FROM corpus_entries').get() as { n: number }).n;
  tx(db, () => {
    for (const name of DOCS) {
      const file = join(dir, `${name}.md`);
      if (!existsSync(file)) continue;
      for (const l of parseLessons(readFileSync(file, 'utf8'))) addEntry(db, { topic: name, text: l.text, source: `${name}.md`, scope: scopeOf(name, l) });
    }
  });
  return (db.prepare('SELECT COUNT(*) AS n FROM corpus_entries').get() as { n: number }).n - before;
}

export function setWeight(db: Db, id: string, weight: number): void {
  db.prepare('UPDATE corpus_entries SET weight = ? WHERE id = ?').run(weight, id);
}

/**
 * The entries to show for a brief. Only those for this kind of film (`scope` or 'all'), general ones plus those whose category appears in the
 * brief. They are taken across topics in turn (craft, motion, reference films, laws) so the five are a mix, heaviest first within a topic and, among
 * equals, in an order that differs per `seed` (the film id) so films do not all get the same few.
 */
export function corpusFor(db: Db, briefText: string, limit = 5, seed = '', scope = 'cinematic'): CorpusEntry[] {
  seedCorpus(db);
  ingestDocs(db);
  ensureFilms(db);
  const text = briefText.toLowerCase();
  const rows = db
    .prepare("SELECT id, topic, category, text, source, weight, scope FROM corpus_entries WHERE weight > 0 AND scope IN ('all', ?)")
    .all(scope) as unknown as CorpusEntry[];
  const byTopic = new Map<string, CorpusEntry[]>();
  for (const r of rows.filter((r) => r.category === '*' || text.includes(r.category.toLowerCase()))) byTopic.set(r.topic, [...(byTopic.get(r.topic) ?? []), r]);
  const order = (a: CorpusEntry, b: CorpusEntry) => b.weight - a.weight || (idOf(seed, a.id) < idOf(seed, b.id) ? -1 : 1);
  const lanes = [...byTopic.values()].map((l) => l.sort(order)).sort((a, b) => order(a[0]!, b[0]!));
  const out: CorpusEntry[] = [];
  for (let i = 0; out.length < limit && lanes.some((l) => l[i]); i++) for (const l of lanes) if (l[i] && out.length < limit) out.push(l[i]!);
  return out;
}

/** The prompt block for a set of entries; empty when there are none. */
export function lessonsBlock(entries: CorpusEntry[]): string {
  return entries.length ? `\n\nLessons from past ads (take the idea, not the things):\n- ${entries.map((e) => e.text).join('\n- ')}` : '';
}

export function recordOutcome(db: Db, o: { filmId: string; briefText: string; entryIds: string[]; status: string; costUsd: number }): void {
  const category =
    (
      db
        .prepare("SELECT category FROM corpus_entries WHERE category != '*' AND ? LIKE '%' || lower(category) || '%' LIMIT 1")
        .get(o.briefText.toLowerCase()) as { category: string } | undefined
    )?.category ?? '*';
  db.prepare(
    `INSERT INTO film_outcomes (film_id, category, entry_ids_json, status, cost_usd, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (film_id) DO UPDATE SET status = excluded.status, cost_usd = excluded.cost_usd, at = excluded.at`,
  ).run(o.filmId, category, JSON.stringify(o.entryIds), o.status, o.costUsd, new Date().toISOString());
}

export interface EntryReport {
  id: string;
  text: string;
  weight: number;
  films: number;
  ready: number;
  avgCostUsd: number;
}

/** Per entry: how many films showed it, how many ended ready, and their average cost. */
export function outcomeReport(db: Db): EntryReport[] {
  return db
    .prepare(
      `SELECT e.id, e.text, e.weight, COUNT(o.film_id) AS films, COALESCE(SUM(o.status = 'ready'), 0) AS ready, COALESCE(AVG(o.cost_usd), 0) AS avgCostUsd
       FROM corpus_entries e LEFT JOIN film_outcomes o ON EXISTS (SELECT 1 FROM json_each(o.entry_ids_json) j WHERE j.value = e.id)
       GROUP BY e.id ORDER BY films DESC, e.weight DESC, e.id`,
    )
    .all() as unknown as EntryReport[];
}
