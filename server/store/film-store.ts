import { randomBytes } from 'node:crypto';
import type { AepCompositionJson } from '@shared/aep';
import { FILM_ID_RE, type FilmState, type FilmVersion } from '@shared/composition';
import type { FilmStore } from '@shared/ports';
import { getDb, tx, type Db } from '../db/open';
import type { CompositionValidator } from '../engine/validate';

export class FilmNotFoundError extends Error {
  constructor(id: string) {
    super(`film not found: ${id}`);
    this.name = 'FilmNotFoundError';
  }
}

type FilmRow = {
  id: string;
  status: FilmState['status'];
  created_at: string;
  head: number;
  max_version: number;
  redo_json: string;
  data_json: string;
};
/** The film's own fields, kept as one JSON column next to the queried ones (id, status, created_at, head, redo). */
type FilmData = Omit<FilmState, 'id' | 'status' | 'createdAt' | 'version' | 'composition' | 'costUsd' | 'clippyCredits'>;

export interface FilmStoreOptions {
  dir: string;
  validator: CompositionValidator;
}

export function createFilmStore({ dir, validator }: FilmStoreOptions): FilmStore {
  const db: Db = getDb(dir);

  const checkId = (id: string) => {
    if (!FILM_ID_RE.test(id)) throw new FilmNotFoundError(String(id));
  };
  const readRow = (id: string): FilmRow => {
    checkId(id);
    const row = db.prepare('SELECT * FROM films WHERE id = ?').get(id) as FilmRow | undefined;
    if (!row) throw new FilmNotFoundError(id);
    return row;
  };
  const writeRow = (r: FilmRow) =>
    db
      .prepare('UPDATE films SET status = ?, head = ?, max_version = ?, redo_json = ?, data_json = ? WHERE id = ?')
      .run(r.status, r.head, r.max_version, r.redo_json, r.data_json, r.id);
  const versionRow = (id: string, n: number) => {
    const v = db.prepare('SELECT * FROM film_versions WHERE film_id = ? AND version = ?').get(id, n) as
      | {
          version: number;
          parent: number | null;
          source: FilmVersion['source'];
          note: string | null;
          at: string;
          composition_json: string;
        }
      | undefined;
    if (!v) throw new FilmNotFoundError(id);
    return v;
  };

  function toState(
    r: FilmRow,
    pre?: { composition_json: string | null; usd: number; credits: number },
  ): FilmState {
    const t =
      pre ??
      (db.prepare('SELECT COALESCE(SUM(usd), 0) AS usd, COALESCE(SUM(credits), 0) AS credits FROM ledger WHERE film_id = ?').get(r.id) as {
        usd: number;
        credits: number;
      });
    const json = pre ? pre.composition_json : r.head > 0 ? versionRow(r.id, r.head).composition_json : null;
    const composition = json ? (JSON.parse(json) as AepCompositionJson) : undefined;
    return {
      ...(JSON.parse(r.data_json) as FilmData),
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      version: r.head,
      ...(composition ? { composition } : {}),
      costUsd: t.usd,
      clippyCredits: t.credits,
    };
  }

  function commitSync(id: string, next: AepCompositionJson, source: FilmVersion['source'], note?: string) {
    const v = validator.validate(next);
    if (!v.ok) return { ok: false as const, issues: v.issues };
    const film = readRow(id);
    const n = film.max_version + 1;
    db.prepare('INSERT INTO film_versions (film_id, version, parent, source, note, at, composition_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      n,
      film.head > 0 ? film.head : null,
      source,
      note ?? null,
      new Date().toISOString(),
      JSON.stringify(next),
    );
    writeRow({ ...film, head: n, max_version: n, redo_json: '[]' });
    return { ok: true as const, version: n };
  }

  return {
    async create(init) {
      const id = `film_${randomBytes(6).toString('hex')}`;
      const { createdAt, ...rest } = init;
      const data: FilmData = { ...rest, assets: init.assets ?? [] };
      const row: FilmRow = {
        id,
        status: 'new',
        created_at: createdAt ?? new Date().toISOString(),
        head: 0,
        max_version: 0,
        redo_json: '[]',
        data_json: JSON.stringify(data),
      };
      db.prepare('INSERT INTO films (id, status, created_at, head, max_version, redo_json, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        row.id,
        row.status,
        row.created_at,
        row.head,
        row.max_version,
        row.redo_json,
        row.data_json,
      );
      return toState(row);
    },

    async get(id) {
      return toState(readRow(id));
    },

    async update(id, patch) {
      tx(db, () => {
        const row = readRow(id);
        const { status, ...rest } = patch;
        writeRow({
          ...row,
          status: status ?? row.status,
          data_json: JSON.stringify({
            ...(JSON.parse(row.data_json) as FilmData),
            ...rest,
          }),
        });
      });
    },

    async list() {
      // one query: the head version and the ledger totals come with each film, not one lookup per film
      const rows = db
        .prepare(
          `SELECT f.*, v.composition_json AS composition_json, COALESCE(l.usd, 0) AS usd, COALESCE(l.credits, 0) AS credits
           FROM films f
           LEFT JOIN film_versions v ON v.film_id = f.id AND v.version = f.head
           LEFT JOIN (SELECT film_id, SUM(usd) AS usd, SUM(credits) AS credits FROM ledger GROUP BY film_id) l ON l.film_id = f.id
           ORDER BY f.created_at DESC`,
        )
        .all() as (FilmRow & { composition_json: string | null; usd: number; credits: number })[];
      return rows.map((r) => toState(r, { composition_json: r.composition_json, usd: r.usd, credits: r.credits }));
    },

    async versions(id) {
      const film = readRow(id);
      const rows = db.prepare('SELECT * FROM film_versions WHERE film_id = ? AND version <= ? ORDER BY version').all(id, film.max_version) as ReturnType<
        typeof versionRow
      >[];
      return rows.map((v) => ({
        version: v.version,
        composition: JSON.parse(v.composition_json) as AepCompositionJson,
        source: v.source,
        ...(v.note !== null ? { note: v.note } : {}),
        at: v.at,
      }));
    },

    async commit(id, next, source, note) {
      return tx(db, () => commitSync(id, next, source, note));
    },

    async mutate(id, fn, source, note) {
      return tx(db, () => {
        const { next, data } = fn(toState(readRow(id))); // synchronous; a throw rolls the transaction back
        const r = commitSync(id, next, source, note);
        return r.ok ? { ok: true as const, version: r.version, data } : r;
      });
    },

    async undo(id) {
      return tx(db, () => {
        const film = readRow(id);
        if (film.head <= 0) return film.head;
        const parent = versionRow(id, film.head).parent;
        if (parent === null) return film.head;
        writeRow({
          ...film,
          head: parent,
          redo_json: JSON.stringify([...(JSON.parse(film.redo_json) as number[]), film.head]),
        });
        return parent;
      });
    },

    async redo(id) {
      return tx(db, () => {
        const film = readRow(id);
        const redo = JSON.parse(film.redo_json) as number[];
        const target = redo.at(-1);
        if (target === undefined) return film.head;
        writeRow({
          ...film,
          head: target,
          redo_json: JSON.stringify(redo.slice(0, -1)),
        });
        return target;
      });
    },
  };
}
