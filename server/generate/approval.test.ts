import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { type ApprovalError, createApprovalStore } from './approval';

const F = 'film_aaaaaaaaaaaa';
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'appr-'));
  let t = Date.parse('2026-11-02T01:00:00Z');
  const mk = () => createApprovalStore({ dir: (f) => join(base, f), now: () => new Date(t) });
  return { mk, advance: (min: number) => (t += min * 60_000) };
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as ApprovalError).code;
  }
};

it('reuses an unexpired proposal and renews after expiry', () => {
  const { mk, advance } = setup();
  const s = mk();
  const a = s.propose(F, 's2', 25);
  expect(a.token).toMatch(/^[0-9a-f]{32}$/);
  advance(29);
  expect(s.propose(F, 's2', 25).token).toBe(a.token);
  advance(2);
  expect(s.propose(F, 's2', 25).token).not.toBe(a.token);
});
it('consumes once and rejects bad, used and expired tokens', () => {
  const { mk, advance } = setup();
  const s = mk();
  const { token } = s.propose(F, 's2', 25);
  const c = s.consume(token, F, 's2');
  expect(c).toMatchObject({ filmId: F, sceneId: 's2', attempt: 1 });
  expect(code(() => s.consume(token, F, 's2'))).toBe('token_used');
  expect(code(() => s.consume('nope', F, 's2'))).toBe('bad_token');
  const t2 = s.propose(F, 's3', 25).token;
  expect(code(() => s.consume(t2, F, 's2'))).toBe('bad_token'); // another scene
  advance(31);
  expect(code(() => s.consume(t2, F, 's3'))).toBe('token_expired');
});
it('counts attempts across consumed approvals and persists them', () => {
  const { mk } = setup();
  const s = mk();
  expect(s.attemptFor(F, 's2')).toBe(1);
  const a = s.propose(F, 's2', 25);
  s.consume(a.token, F, 's2');
  const b = s.propose(F, 's2', 25);
  expect(b.token).not.toBe(a.token);
  expect(b.attempt).toBe(2);
  s.consume(b.token, F, 's2');
  expect(s.attemptFor(F, 's2')).toBe(3);
  expect(mk().attemptFor(F, 's2')).toBe(3); // a new instance sees the consumed state
  expect(mk().hasProposal(F, 's2')).toBe(false);
});
