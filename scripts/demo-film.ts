// Owned by S12e. The committed fake-mode crew film: `npx tsx scripts/demo-film.ts load [dataDir]` puts it into a data dir so the gallery lists it and its replay plays, with no spend and no network.
// `export <srcDataDir> <filmId>` re-records the fixture from a fake-mode run (DIRECTOR_FAKE=1).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEMO_DIR = fileURLToPath(new URL('../fixtures/s12e/demo-film', import.meta.url));

/** The keys, cookies and long data: URLs the fixtures must never hold (guardrail). */
export function redact(text: string): string {
  return text
    .replace(/"(authorization|cookie|x-director-passcode|apiKey|api_key)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g, 'data:redacted');
}

/** Copies one film's record, versions, event log and the assets it names into the fixture folder. */
export function exportDemoFilm(srcDataDir: string, filmId: string, outDir = DEMO_DIR): void {
  const film = join(srcDataDir, 'films', filmId);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'versions'), { recursive: true });
  mkdirSync(join(outDir, 'assets'), { recursive: true });
  for (const f of ['film.json', 'events.jsonl']) writeFileSync(join(outDir, f), redact(readFileSync(join(film, f), 'utf8')));
  // the log is a list of {seq, event}; the fixture keeps the events as they are
  for (const v of readdirSync(join(film, 'versions'))) writeFileSync(join(outDir, 'versions', v), redact(readFileSync(join(film, 'versions', v), 'utf8')));
  const record = JSON.parse(readFileSync(join(film, 'film.json'), 'utf8')) as { assets: Array<{ id: string; mime: string }> };
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
