// One SQLite file per DATA_DIR (director.db), one connection per process. better-sqlite3 is synchronous.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

export type Db = Database.Database;

export const DB_FILE = 'director.db';

const open = new Map<string, Db>();
const depth = new WeakMap<Db, number>();

/** Apply every migration the file has not seen. A database newer than this build is refused. */
export function migrate(db: Db): number {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (current > MIGRATIONS.length) throw new Error(`director.db is schema v${current}, this build knows v${MIGRATIONS.length}`);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return MIGRATIONS.length;
}

/** Open (or create) a database at an explicit path, ':memory:' included. Not cached. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** The shared connection for a data directory; created on first use. */
export function getDb(dataDir: string): Db {
  const key = resolve(dataDir);
  let db = open.get(key);
  if (!db) {
    mkdirSync(key, { recursive: true });
    db = openDatabase(join(key, DB_FILE));
    open.set(key, db);
  }
  return db;
}

export function closeDb(dataDir: string): void {
  const key = resolve(dataDir);
  open.get(key)?.close();
  open.delete(key);
}

/** Run `fn` in one BEGIN IMMEDIATE transaction: commit on return, roll back on throw. Re-entrant (inner calls join). */
export function tx<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth.set(db, 0);
  }
}
