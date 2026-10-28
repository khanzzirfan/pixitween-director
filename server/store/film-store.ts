import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { FILM_ID_RE, type FilmState, type FilmVersion } from '@shared/composition';
import type { FilmStore } from '@shared/ports';
import type { CompositionValidator } from '../engine/validate';

export class FilmNotFoundError extends Error {
  constructor(id: string) {
    super(`film not found: ${id}`);
    this.name = 'FilmNotFoundError';
  }
}

type FilmFile = Omit<FilmState, 'composition' | 'costUsd' | 'clippyCredits'> & { head: number; maxVersion: number; redo: number[] };
type VersionFile = FilmVersion & { parent: number | null };

export interface FilmStoreOptions {
  dir: string;
  validator: CompositionValidator;
}

export function createFilmStore({ dir, validator }: FilmStoreOptions): FilmStore {
  const root = join(dir, 'films');
  const chains = new Map<string, Promise<unknown>>();

  const filmDir = (id: string) => {
    if (!FILM_ID_RE.test(id)) throw new FilmNotFoundError(String(id));
    return join(root, id);
  };

  /** Serialise every operation on one film (promise-chain mutex). */
  function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    chains.set(id, run.catch(() => undefined));
    return run;
  }

  async function writeJson(file: string, data: unknown) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, file);
  }
  async function readJson<T>(file: string, id: string): Promise<T> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new FilmNotFoundError(id);
      throw e;
    }
  }
  const readFilm = (id: string) => readJson<FilmFile>(join(filmDir(id), 'film.json'), id);
  const readVersion = (id: string, n: number) => readJson<VersionFile>(join(filmDir(id), 'versions', `${n}.json`), id);

  async function ledgerTotals(id: string): Promise<{ usd: number; credits: number }> {
    let text = '';
    try {
      text = await readFile(join(filmDir(id), 'ledger.jsonl'), 'utf8');
    } catch {
      return { usd: 0, credits: 0 };
    }
    let usd = 0;
    let credits = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { usd?: number; credits?: number };
        usd += row.usd ?? 0;
        credits += row.credits ?? 0;
      } catch {
        // ignore a truncated final line
      }
    }
    return { usd, credits };
  }

  async function toState(id: string, f: FilmFile): Promise<FilmState> {
    const { head, maxVersion: _max, redo: _redo, ...rest } = f;
    const { usd, credits } = await ledgerTotals(id);
    const composition = head > 0 ? (await readVersion(id, head)).composition : undefined;
    return { ...rest, version: head, ...(composition ? { composition } : {}), costUsd: usd, clippyCredits: credits };
  }

  async function commitLocked(id: string, next: AepCompositionJson, source: FilmVersion['source'], note?: string) {
    const v = validator.validate(next);
    if (!v.ok) return { ok: false as const, issues: v.issues };
    const film = await readFilm(id);
    const n = film.maxVersion + 1;
    const version: VersionFile = {
      version: n,
      composition: next,
      source,
      ...(note !== undefined ? { note } : {}),
      at: new Date().toISOString(),
      parent: film.head > 0 ? film.head : null,
    };
    await writeJson(join(filmDir(id), 'versions', `${n}.json`), version);
    await writeJson(join(filmDir(id), 'film.json'), { ...film, head: n, maxVersion: n, version: n, redo: [] });
    return { ok: true as const, version: n };
  }

  return {
    async create(init) {
      const id = `film_${randomBytes(6).toString('hex')}`;
      const film: FilmFile = {
        ...init,
        id,
        status: 'new',
        version: 0,
        assets: init.assets ?? [],
        createdAt: init.createdAt ?? new Date().toISOString(),
        head: 0,
        maxVersion: 0,
        redo: [],
      };
      await locked(id, () => writeJson(join(filmDir(id), 'film.json'), film));
      return toState(id, film);
    },

    async get(id) {
      return locked(id, async () => toState(id, await readFilm(id)));
    },

    update(id, patch) {
      return locked(id, async () => {
        const film = await readFilm(id);
        await writeJson(join(filmDir(id), 'film.json'), { ...film, ...patch });
      });
    },

    async list() {
      const ids = await readdir(root).catch(() => [] as string[]);
      const films = await Promise.all(ids.filter((i) => FILM_ID_RE.test(i)).map((i) => this.get(i).catch(() => undefined)));
      return films.filter((f): f is FilmState => !!f).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    versions(id) {
      return locked(id, async () => {
        const film = await readFilm(id);
        const out: FilmVersion[] = [];
        for (let n = 1; n <= film.maxVersion; n++) {
          const { parent: _parent, ...v } = await readVersion(id, n);
          out.push(v);
        }
        return out;
      });
    },

    commit: (id, next, source, note) => locked(id, () => commitLocked(id, next, source, note)),

    mutate(id, fn, source, note) {
      return locked(id, async () => {
        const film = await toState(id, await readFilm(id));
        const { next, data } = fn(film); // synchronous; a throw stores nothing and propagates
        const r = await commitLocked(id, next, source, note);
        return r.ok ? { ok: true as const, version: r.version, data } : r;
      });
    },

    undo(id) {
      return locked(id, async () => {
        const film = await readFilm(id);
        if (film.head <= 0) return film.head;
        const parent = (await readVersion(id, film.head)).parent;
        if (parent === null) return film.head;
        await writeJson(join(filmDir(id), 'film.json'), { ...film, head: parent, version: parent, redo: [...film.redo, film.head] });
        return parent;
      });
    },

    redo(id) {
      return locked(id, async () => {
        const film = await readFilm(id);
        const target = film.redo.at(-1);
        if (target === undefined) return film.head;
        await writeJson(join(filmDir(id), 'film.json'), { ...film, head: target, version: target, redo: film.redo.slice(0, -1) });
        return target;
      });
    },
  };
}
