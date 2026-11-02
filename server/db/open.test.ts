import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, openDatabase, tx } from './open';
import { MIGRATIONS } from './migrations';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    closeDb(d);
    rmSync(d, { recursive: true, force: true });
  }
});
const tmp = () => (dirs.push(mkdtempSync(join(tmpdir(), 'db-'))), dirs.at(-1)!);

describe('db open', () => {
  it('creates the file with WAL, fk and the latest schema version', () => {
    const db = getDb(tmp());
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
  });
  it('is cached per directory', () => {
    const d = tmp();
    expect(getDb(d)).toBe(getDb(d));
  });
  it('refuses a database newer than the code', () => {
    const path = join(tmp(), 'new.db');
    const db = openDatabase(path);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.close();
    expect(() => openDatabase(path)).toThrow(/schema v/);
  });
  it('tx rolls back on throw and joins when nested', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      tx(db, () => {
        db.prepare("INSERT INTO approvals VALUES ('a','[]')").run();
        tx(db, () => db.prepare("INSERT INTO approvals VALUES ('b','[]')").run());
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM approvals').get()).toEqual({
      n: 0,
    });
  });
});
