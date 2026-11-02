// Owned by S12e. The committed fake-mode crew film: `npx tsx scripts/demo-film.ts load [dataDir]` puts it into a data dir so the gallery lists it and its replay plays, with no spend and no network.
// `export <srcDataDir> <filmId>` re-records the fixture from a fake-mode run (DIRECTOR_FAKE=1).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importLegacyData } from '../server/db/import-legacy';
import { getDb } from '../server/db/open';

export const DEMO_DIR = fileURLToPath(new URL('../fixtures/s12e/demo-film', import.meta.url));

/** The keys, cookies and long data: URLs the fixtures must never hold (guardrail). */
export function redact(text: string): string {
  return text
    .replace(/"(authorization|cookie|x-director-passcode|apiKey|api_key)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g, 'data:redacted');
}

/** Writes one film's record, versions, event log and the assets it names from director.db into the fixture folder (the fixture keeps the old file layout). */
export function exportDemoFilm(srcDataDir: string, filmId: string, outDir = DEMO_DIR): void {
  const db = getDb(srcDataDir);
  const row = db.prepare('SELECT * FROM films WHERE id = ?').get(filmId) as
    | { id: string; status: string; created_at: string; head: number; max_version: number; redo_json: string; data_json: string }
    | undefined;
  if (!row) throw new Error(`no film ${filmId} in ${srcDataDir}/director.db`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'versions'), { recursive: true });
  mkdirSync(join(outDir, 'assets'), { recursive: true });
  const record = {
    ...(JSON.parse(row.data_json) as { assets: Array<{ id: string; mime: string }> }),
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    version: row.head,
    head: row.head,
    maxVersion: row.max_version,
    redo: JSON.parse(row.redo_json) as number[],
  };
  writeFileSync(join(outDir, 'film.json'), redact(JSON.stringify(record)));
  const events = db.prepare('SELECT seq, event_json FROM events WHERE film_id = ? ORDER BY seq').all(filmId) as { seq: number; event_json: string }[];
  writeFileSync(join(outDir, 'events.jsonl'), redact(events.map((e) => `{"seq":${e.seq},"event":${e.event_json}}`).join('\n') + '\n'));
  const versions = db.prepare('SELECT * FROM film_versions WHERE film_id = ? ORDER BY version').all(filmId) as {
    version: number;
    parent: number | null;
    source: string;
    note: string | null;
    at: string;
    composition_json: string;
  }[];
  for (const v of versions) {
    const body = { version: v.version, composition: JSON.parse(v.composition_json), source: v.source, ...(v.note !== null ? { note: v.note } : {}), at: v.at, parent: v.parent };
    writeFileSync(join(outDir, 'versions', `${v.version}.json`), redact(JSON.stringify(body)));
  }
  for (const a of record.assets) for (const ext of ['json', a.mime === 'image/jpeg' ? 'jpg' : 'png']) cpSync(join(srcDataDir, 'assets', `${a.id}.${ext}`), join(outDir, 'assets', `${a.id}.${ext}`));
}

/** Puts the fixture film into `dataDir` (created if missing). Returns its id. */
export function loadDemoFilm(dataDir: string, from = DEMO_DIR): string {
  const record = JSON.parse(readFileSync(join(from, 'film.json'), 'utf8')) as { id: string };
  const dest = join(dataDir, 'films', record.id);
  mkdirSync(join(dest, 'versions'), { recursive: true });
  mkdirSync(join(dataDir, 'assets'), { recursive: true });
  for (const f of ['film.json', 'events.jsonl']) cpSync(join(from, f), join(dest, f));
  cpSync(join(from, 'versions'), join(dest, 'versions'), { recursive: true });
  cpSync(join(from, 'assets'), join(dataDir, 'assets'), { recursive: true });
  importLegacyData(dataDir);
  return record.id;
}

/** The events of the fixture, in log order. */
export function demoEvents(from = DEMO_DIR): unknown[] {
  return readFileSync(join(from, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { event: unknown }).event);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'load') console.log(`loaded ${loadDemoFilm(resolve(a ?? process.env.DATA_DIR ?? './data'))}`);
  else if (cmd === 'export' && a && b && existsSync(a)) exportDemoFilm(resolve(a), b);
  else console.log('usage: tsx scripts/demo-film.ts load [dataDir] | export <srcDataDir> <filmId>');
}
