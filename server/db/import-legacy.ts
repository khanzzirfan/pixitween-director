// One-time, idempotent import of the old file layout under DATA_DIR into director.db. The files are never changed or
// deleted (they stay as the backup); every film, asset and line-up is imported at most once, tracked in import_log.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_ID_RE, FILM_ID_RE } from '@shared/composition';
import { LINEUP_ID_RE } from '@shared/lineup';
import { getDb, tx, type Db } from './open';

export interface ImportReport {
  films: number;
  versions: number;
  events: number;
  ledger: number;
  assets: number;
  lineups: number;
  jobs: number;
  checkpoints: number;
  skipped: string[];
}

const STOPPED = 'stopped: the server restarted before this film was finished';

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
/** JSONL body to rows; a truncated or corrupt line is dropped. */
function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // half-written last line
    }
  }
  return out;
}
const ls = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);
const u8 = (v: unknown): Buffer | undefined =>
  v && typeof v === 'object' && typeof (v as Record<string, unknown>).__lg_u8 === 'string'
    ? Buffer.from((v as Record<string, string>).__lg_u8!, 'base64')
    : undefined;

const done = (db: Db, source: string) => !!db.prepare('SELECT 1 FROM import_log WHERE source = ?').get(source);
const mark = (db: Db, source: string, rows: unknown) =>
  db.prepare('INSERT INTO import_log (source, imported_at, rows_json) VALUES (?, ?, ?)').run(source, new Date().toISOString(), JSON.stringify(rows));

type Dict = Record<string, unknown>;

function importFilm(db: Db, dataDir: string, id: string, r: ImportReport): void {
  const dir = join(dataDir, 'films', id);
  const film = readJson<Dict & { head: number; maxVersion: number; redo?: number[]; status: string; createdAt: string }>(join(dir, 'film.json'));
  if (!film) {
    r.skipped.push(`film:${id} (no readable film.json)`);
    return;
  }
  tx(db, () => {
    const { id: _id, status, createdAt, head, maxVersion, redo, version: _v, ...data } = film;
    db.prepare('INSERT OR IGNORE INTO films (id, status, created_at, head, max_version, redo_json, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      status,
      createdAt,
      head ?? 0,
      maxVersion ?? 0,
      JSON.stringify(redo ?? []),
      JSON.stringify(data),
    );
    const counts = { versions: 0, events: 0, ledger: 0, jobs: 0 };
    const insV = db.prepare('INSERT OR IGNORE INTO film_versions (film_id, version, parent, source, note, at, composition_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let n = 1; n <= (maxVersion ?? 0); n++) {
      const v = readJson<Dict & { parent: number | null; source: string; note?: string; at: string; composition: unknown }>(join(dir, 'versions', `${n}.json`));
      if (!v) continue;
      insV.run(id, n, v.parent ?? null, v.source, v.note ?? null, v.at, JSON.stringify(v.composition));
      counts.versions++;
    }
    const insE = db.prepare('INSERT OR IGNORE INTO events (film_id, seq, type, at, event_json) VALUES (?, ?, ?, ?, ?)');
    for (const e of readJsonl<{ seq: number; event: { type: string; at?: string } }>(join(dir, 'events.jsonl'))) {
      insE.run(id, e.seq, e.event.type, e.event.at ?? film.createdAt, JSON.stringify(e.event));
      counts.events++;
    }
    const insL = db.prepare('INSERT INTO ledger (film_id, at, model, units, usd, credits) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of readJsonl<{ at?: string; model?: string; units?: unknown; usd?: number; credits?: number }>(join(dir, 'ledger.jsonl'))) {
      insL.run(id, l.at ?? film.createdAt, l.model ?? 'unknown', JSON.stringify(l.units ?? ''), l.usd ?? 0, l.credits ?? 0);
      counts.ledger++;
    }
    const board = readJson<unknown[]>(join(dir, 'crew', 'board.json'));
    if (board)
      db.prepare('INSERT OR IGNORE INTO crew_board (film_id, jobs_json, updated_at) VALUES (?, ?, ?)').run(id, JSON.stringify(board), new Date().toISOString());
    for (const f of ls(join(dir, 'crew', 'snapshots')).filter((x) => /^j\d+\.json$/.test(x))) {
      const snap = readJson<unknown>(join(dir, 'crew', 'snapshots', f));
      if (snap)
        db.prepare('INSERT OR IGNORE INTO crew_snapshots (film_id, job_id, snapshot_json) VALUES (?, ?, ?)').run(id, f.slice(0, -5), JSON.stringify(snap));
    }
    const approvals = readJson<unknown[]>(join(dir, 'approvals.json'));
    if (approvals) db.prepare('INSERT OR IGNORE INTO approvals (film_id, entries_json) VALUES (?, ?)').run(id, JSON.stringify(approvals));
    for (const f of ls(join(dir, 'generate')).filter((x) => x.endsWith('.json'))) {
      const j = readJson<{ sceneId: string; status: string; updatedAt?: string }>(join(dir, 'generate', f));
      if (!j?.sceneId) continue;
      db.prepare('INSERT OR IGNORE INTO generate_jobs (film_id, scene_id, status, record_json, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        j.sceneId,
        j.status,
        JSON.stringify(j),
        j.updatedAt ?? film.createdAt,
      );
      counts.jobs++;
    }
    r.checkpoints += importCheckpoints(db, id, join(dir, 'crew', 'checkpoints', 'showrunner.json'));
    r.films++;
    r.versions += counts.versions;
    r.events += counts.events;
    r.ledger += counts.ledger;
    r.jobs += counts.jobs;
    mark(db, `film:${id}`, counts);
  });
}

/** The old FileSaver wrote MemorySaver's two maps as JSON with base64 byte markers; rewrite them as lg_ rows. */
function importCheckpoints(db: Db, threadId: string, file: string): number {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (!raw) return 0;
  let parsed: { storage?: Dict; writes?: Dict };
  try {
    parsed = JSON.parse(raw) as { storage?: Dict; writes?: Dict };
  } catch {
    return 0;
  }
  let n = 0;
  const insC = db.prepare(
    'INSERT OR IGNORE INTO lg_checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insW = db.prepare(
    'INSERT OR IGNORE INTO lg_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, task_path, channel, type, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [thread, nss] of Object.entries((parsed.storage ?? {}) as Record<string, Record<string, Record<string, unknown[]>>>)) {
    if (thread !== threadId) continue;
    for (const [ns, cps] of Object.entries(nss))
      for (const [cpId, [cp, meta, parent]] of Object.entries(cps)) {
        const [c, m] = [u8(cp), u8(meta)];
        if (!c || !m) continue;
        insC.run(thread, ns, cpId, (parent as string | undefined) ?? null, 'json', c, m);
        n++;
      }
  }
  for (const [key, inner] of Object.entries((parsed.writes ?? {}) as Record<string, Record<string, unknown[]>>)) {
    const [thread, ns, cpId] = JSON.parse(key) as [string, string, string];
    if (thread !== threadId) continue;
    for (const [innerKey, [taskId, channel, value, taskPath]] of Object.entries(inner)) {
      const v = u8(value);
      if (!v) continue;
      insW.run(
        thread,
        ns,
        cpId,
        taskId as string,
        Number(innerKey.slice(innerKey.lastIndexOf(',') + 1)),
        (taskPath as string | undefined) ?? '',
        channel as string,
        'json',
        v,
      );
    }
  }
  return n;
}

function importAssets(db: Db, dataDir: string, r: ImportReport): void {
  const dir = join(dataDir, 'assets');
  const names = ls(dir);
  for (const f of names.filter((x) => x.endsWith('.json'))) {
    const id = f.slice(0, -5);
    if (!ASSET_ID_RE.test(id) || done(db, `asset:${id}`)) continue;
    const meta = readJson<{ id: string; mime: string }>(join(dir, f));
    const file = names.find((x) => x.startsWith(`${id}.`) && x !== f);
    if (!meta || !file) {
      r.skipped.push(`asset:${id} (meta or bytes missing)`);
      continue;
    }
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO assets (id, mime, file, bytes, created_at, meta_json) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        meta.mime,
        file,
        statSync(join(dir, file)).size,
        statSync(join(dir, f)).mtime.toISOString(),
        JSON.stringify(meta),
      );
      mark(db, `asset:${id}`, {});
    });
    r.assets++;
  }
}

function importLineups(db: Db, dataDir: string, r: ImportReport): void {
  const dir = join(dataDir, 'lineups');
  for (const f of ls(dir).filter((x) => x.endsWith('.json'))) {
    const id = f.slice(0, -5);
    if (!LINEUP_ID_RE.test(id) || done(db, `lineup:${id}`)) continue;
    const l = readJson<{ aspect: string; brief?: string; createdAt: string; items: { product: unknown; filmId?: string; state: string; error?: string }[] }>(
      join(dir, f),
    );
    if (!l) {
      r.skipped.push(`lineup:${id} (unreadable)`);
      continue;
    }
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO lineups (id, aspect, brief, created_at) VALUES (?, ?, ?, ?)').run(id, l.aspect, l.brief ?? '', l.createdAt);
      const ins = db.prepare('INSERT OR IGNORE INTO lineup_items (lineup_id, position, product_json, film_id, state, error) VALUES (?, ?, ?, ?, ?, ?)');
      l.items.forEach((i, n) => {
        // the old runner died with its process: what it left unfinished stays failed, so no old line-up starts paid work on its own
        const open = i.state === 'making' || i.state === 'waiting';
        ins.run(id, n, JSON.stringify(i.product), i.filmId ?? null, open ? 'failed' : i.state, open ? STOPPED : (i.error ?? null));
      });
      mark(db, `lineup:${id}`, { items: l.items.length });
    });
    r.lineups++;
  }
}

export function importLegacyData(dataDir: string): ImportReport {
  const db = getDb(dataDir);
  const r: ImportReport = { films: 0, versions: 0, events: 0, ledger: 0, assets: 0, lineups: 0, jobs: 0, checkpoints: 0, skipped: [] };
  for (const id of ls(join(dataDir, 'films')).filter((x) => FILM_ID_RE.test(x))) {
    if (!done(db, `film:${id}`)) importFilm(db, dataDir, id, r);
  }
  importAssets(db, dataDir, r);
  importLineups(db, dataDir, r);
  return r;
}
