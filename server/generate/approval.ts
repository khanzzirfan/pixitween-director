// Owned by S7a. Single-use, expiring approval tokens: nothing is generated without a click.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
export type ConsumedApproval = { readonly filmId: string; readonly sceneId: string; readonly attempt: number; readonly consumedAt: string; readonly [consumedBrand]: true };

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
  dir?: (filmId: string) => string;
  now?: () => Date;
  ttlMs?: number;
  random?: () => string;
}

export function createApprovalStore(o: ApprovalStoreOptions = {}) {
  const dirOf = o.dir ?? ((filmId: string) => join(loadEnv().DATA_DIR, 'films', filmId));
  const now = o.now ?? (() => new Date());
  const ttl = o.ttlMs ?? 30 * 60_000;
  const random = o.random ?? (() => randomBytes(16).toString('hex'));
  const file = (filmId: string) => join(dirOf(filmId), 'approvals.json');

  const read = (filmId: string): Entry[] => {
    try {
      return JSON.parse(readFileSync(file(filmId), 'utf8')) as Entry[];
    } catch {
      return [];
    }
  };
  const write = (filmId: string, entries: Entry[]) => {
    mkdirSync(dirOf(filmId), { recursive: true });
    const tmp = `${file(filmId)}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries, null, 2));
    renameSync(tmp, file(filmId));
  };
  const consumedCount = (entries: Entry[], sceneId: string) => entries.filter((e) => e.sceneId === sceneId && e.consumedAt).length;

  return {
    propose(filmId: string, sceneId: string, estCredits: number): { token: string; attempt: number; expiresAt: string } {
      const entries = read(filmId);
      const live = entries.find((e) => e.sceneId === sceneId && !e.consumedAt && new Date(e.expiresAt) > now());
      if (live) return { token: live.token, attempt: live.attempt, expiresAt: live.expiresAt };
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
      return { token: entry.token, attempt: entry.attempt, expiresAt: entry.expiresAt };
    },

    /** Atomic: marks the approval consumed before returning. */
    consume(token: string, filmId: string, sceneId: string): ConsumedApproval {
      const entries = read(filmId);
      const e = entries.find((x) => x.token === token && x.sceneId === sceneId);
      if (!e) throw new ApprovalError('bad_token');
      if (e.consumedAt) throw new ApprovalError('token_used');
      if (new Date(e.expiresAt) <= now()) throw new ApprovalError('token_expired');
      e.consumedAt = now().toISOString();
      write(filmId, entries);
      return { filmId, sceneId, attempt: e.attempt, consumedAt: e.consumedAt } as ConsumedApproval;
    },

    attemptFor: (filmId: string, sceneId: string): number => consumedCount(read(filmId), sceneId) + 1,
    hasProposal: (filmId: string, sceneId: string): boolean => read(filmId).some((e) => e.sceneId === sceneId && !e.consumedAt && new Date(e.expiresAt) > now()),
  };
}

export type ApprovalStore = ReturnType<typeof createApprovalStore>;
