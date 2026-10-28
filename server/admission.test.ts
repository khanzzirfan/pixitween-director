import { expect, it } from 'vitest';
import { createDirectAdmission, getAdmission } from './admission';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 5));

it('caps films in flight and frees slots', async () => {
  const a = createDirectAdmission({ maxInFlight: 2 });
  const d1 = deferred();
  expect(a.submit('film_1', () => d1.promise)).toEqual({ state: 'running' });
  expect(a.submit('film_2', () => new Promise<void>(() => undefined))).toEqual({ state: 'running' });
  expect(a.canAccept()).toEqual({ ok: false, retryAfterSec: 30 });
  expect(a.submit('film_3', async () => undefined)).toEqual({ state: 'rejected', retryAfterSec: 30 });
  d1.resolve();
  await tick();
  expect(a.canAccept()).toEqual({ ok: true });
  expect(a.submit('film_3', async () => undefined)).toEqual({ state: 'running' });
  expect(a.stats()).toMatchObject({ maxInFlight: 2, queued: 0, maxQueued: 0 });
});

it('a rejected run frees its slot without throwing', async () => {
  const a = createDirectAdmission({ maxInFlight: 1 });
  const d = deferred();
  expect(() => a.submit('film_1', () => d.promise)).not.toThrow();
  d.reject(new Error('boom'));
  await tick();
  expect(a.position('film_1')).toEqual({ state: 'unknown' });
  expect(a.canAccept()).toEqual({ ok: true });
});

it('does not start a film twice', () => {
  const a = createDirectAdmission({ maxInFlight: 2 });
  let starts = 0;
  const run = () => (starts++, new Promise<void>(() => undefined));
  a.submit('film_1', run);
  expect(a.submit('film_1', run)).toEqual({ state: 'running' });
  expect(starts).toBe(1);
  expect(a.position('film_1')).toEqual({ state: 'running' });
});

it('getAdmission prefers deps.admission, else a stable default', () => {
  expect(getAdmission({})).toBe(getAdmission({}));
  const x = createDirectAdmission({ maxInFlight: 1 });
  expect(getAdmission({ admission: x })).toBe(x);
  expect(getAdmission({}).stats().maxInFlight).toBe(2);
});
