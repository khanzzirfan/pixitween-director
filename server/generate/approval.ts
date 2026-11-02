// Owned by S7a. Single-use, expiring approval tokens: nothing is generated without a click.
import { randomBytes } from 'node:crypto';
import { getDb, tx } from '../db/open';
import { loadEnv } from '../env';

export class ApprovalError extends Error {
  readonly code: 'bad_token' | 'token_expired' | 'token_used';
  constructor(code: ApprovalError['code']) {
    super(code);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

declare const consumedBrand: unique symbol;
/** Only `consume()` can create one. */
export type ConsumedApproval = {
  readonly filmId: string;
  readonly sceneId: string;
  readonly attempt: number;
  readonly consumedAt: string;
  readonly [consumedBrand]: true;
};

interface Entry {
  token: string;
  sceneId: string;
  attempt: number;
  estCredits: number;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface ApprovalStoreOptions {
  dataDir?: string;
  now?: () => Date;
  ttlMs?: number;
  random?: () => string;
}

export function createApprovalStore(o: ApprovalStoreOptions = {}) {
  const db = () => getDb(o.dataDir ?? loadEnv().DATA_DIR);
  const now = o.now ?? (() => new Date());
  const ttl = o.ttlMs ?? 30 * 60_000;
  const random = o.random ?? (() => randomBytes(16).toString('hex'));
  const read = (filmId: string): Entry[] => {
    const row = db().prepare('SELECT entries_json FROM approvals WHERE film_id = ?').get(filmId) as { entries_json: string } | undefined;
    return row ? (JSON.parse(row.entries_json) as Entry[]) : [];
  };
  const write = (filmId: string, entries: Entry[]) => {
    db()
      .prepare('INSERT INTO approvals (film_id, entries_json) VALUES (?, ?) ON CONFLICT (film_id) DO UPDATE SET entries_json = excluded.entries_json')
      .run(filmId, JSON.stringify(entries));
  };
  const consumedCount = (entries: Entry[], sceneId: string) => entries.filter((e) => e.sceneId === sceneId && e.consumedAt).length;

  return {
    propose: (filmId: string, sceneId: string, estCredits: number): { token: string; attempt: number; expiresAt: string } =>
      tx(db(), () => {
        const entries = read(filmId);
        const live = entries.find((e) => e.sceneId === sceneId && !e.consumedAt && new Date(e.expiresAt) > now());
        if (live)
          return {
            token: live.token,
            attempt: live.attempt,
            expiresAt: live.expiresAt,
          };
        const entry: Entry = {
          token: random(),
          sceneId,
          attempt: consumedCount(entries, sceneId) + 1,
          estCredits,
          createdAt: now().toISOString(),
          expiresAt: new Date(now().getTime() + ttl).toISOString(),
          consumedAt: null,
        };
        write(filmId, [...entries, entry]);
        return {
          token: entry.token,
          attempt: entry.attempt,
          expiresAt: entry.expiresAt,
        };
      }),

    /** Atomic: marks the approval consumed before returning. */
    consume: (token: string, filmId: string, sceneId: string): ConsumedApproval =>
      tx(db(), () => {
        const entries = read(filmId);
        const e = entries.find((x) => x.token === token && x.sceneId === sceneId);
        if (!e) throw new ApprovalError('bad_token');
        if (e.consumedAt) throw new ApprovalError('token_used');
        if (new Date(e.expiresAt) <= now()) throw new ApprovalError('token_expired');
        e.consumedAt = now().toISOString();
        write(filmId, entries);
        return {
          filmId,
          sceneId,
          attempt: e.attempt,
          consumedAt: e.consumedAt,
        } as ConsumedApproval;
      }),

    attemptFor: (filmId: string, sceneId: string): number => consumedCount(read(filmId), sceneId) + 1,
    hasProposal: (filmId: string, sceneId: string): boolean =>
      read(filmId).some((e) => e.sceneId === sceneId && !e.consumedAt && new Date(e.expiresAt) > now()),
  };
}

export type ApprovalStore = ReturnType<typeof createApprovalStore>;
