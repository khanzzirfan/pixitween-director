import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkPrdComplete, checkPrdExpected, EXPECTED_PRDS } from './prd';

const prd = (stories: Array<{ id: string; passes: boolean; notes?: string }>) => JSON.stringify({ userStories: stories });
const one = (text: string) => checkPrdComplete(makeCtx({ 'ralph/prd-x.json': text }))[0]!;

it('passes a PRD whose 3 stories pass, naming 3/3', () => {
  const r = one(prd([1, 2, 3].map((n) => ({ id: `US-00${n}`, passes: true }))));
  expect(r.status).toBe('pass');
  expect(r.detail).toContain('3/3');
});

it('is pending for an open story with a note, and fails, listing the id, when the note is empty', () => {
  expect(one(prd([{ id: 'US-001', passes: true }, { id: 'US-002', passes: false, notes: 'blocked: engine' }])).status).toBe('pending');
  const r = one(prd([{ id: 'US-007', passes: false, notes: '' }]));
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('US-007');
});

it('shortens a long list of stories without notes', () => {
  const r = one(prd(Array.from({ length: 30 }, (_, i) => ({ id: `US-${String(i + 1).padStart(3, '0')}`, passes: false }))));
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('0/30');
  expect(r.detail).toContain('and 27 more');
  expect(r.detail.length).toBeLessThan(120);
});

it('fails for invalid JSON', () => {
  expect(one('{ not json').status).toBe('fail');
});

it('gives one result per PRD file, ignoring other files in ralph/', () => {
  const rs = checkPrdComplete(makeCtx({ 'ralph/prd-a.json': prd([{ id: 'a', passes: true }]), 'ralph/prd-b.json': prd([{ id: 'b', passes: true }]), 'ralph/README.md': '', 'ralph/src/prd-a.json': '{}' }));
  expect(rs.map((r) => r.id)).toEqual(['prd.complete:prd-a', 'prd.complete:prd-b']);
});

it('names the missing PRD file when 13 of the 14 are tracked, and passes with all 14', () => {
  const all = EXPECTED_PRDS.map((s) => `ralph/${s}.json`);
  const r = checkPrdExpected(makeCtx({}, { tracked: all.filter((p) => !p.includes('s11')) }))[0]!;
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('prd-s11-mcp-server');
  expect(checkPrdExpected(makeCtx({}, { tracked: all }))[0]!.status).toBe('pass');
  expect(EXPECTED_PRDS).toHaveLength(14);
});
