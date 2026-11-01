import { expect, it } from 'vitest';
import { REQUIRED_DOCS } from '../required-docs';
import { makeCtx } from '../testing';
import { checkDoc, checkDocs, checkOwnerMarkers, headingsOf } from './docs';

const readme = REQUIRED_DOCS[0]!;
const body = (headings = readme.headings) => headings.map((h) => `${'#'.repeat(h.level)} ${h.text}\n\ntext\n`).join('\n');

it('has 7 required documents and 12 README headings', () => {
  expect(REQUIRED_DOCS).toHaveLength(7);
  expect(readme.headings).toHaveLength(12);
});

it('passes when all 12 README headings are present in order', () => {
  expect(checkDoc(makeCtx({ 'README.md': body() }), readme)).toMatchObject({ id: 'docs:README.md', status: 'pass' });
});

it("fails naming 'Team' when the Team heading is missing", () => {
  const r = checkDoc(makeCtx({ 'README.md': body(readme.headings.filter((x) => x.text !== 'Team')) }), readme);
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('Team');
});

it("fails naming 'Demo' when Demo comes before What it does", () => {
  const swapped = [...readme.headings];
  [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
  const r = checkDoc(makeCtx({ 'README.md': body(swapped) }), readme);
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('Demo');
});

it('fails with the line number of a draft marker', () => {
  const lines = body().split('\n');
  lines[6] = 'something <fill: x> here';
  const r = checkDoc(makeCtx({ 'README.md': lines.join('\n') }), readme);
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('7');
});

it('wants the exact level: a ### where ## is required fails', () => {
  const r = checkDoc(makeCtx({ 'README.md': body().replace('## Team', '### Team') }), readme);
  expect(r.status).toBe('fail');
});

it('fails for a document that is not there, once per required document', () => {
  const rs = checkDocs(makeCtx({}));
  expect(rs).toHaveLength(7);
  expect(rs.every((x) => x.status === 'fail' && x.detail.includes('missing'))).toBe(true);
});

it('does not read a heading inside a code fence', () => {
  expect(headingsOf('# A\n```\n## B\n```\n## C')).toEqual([{ level: 1, text: 'A' }, { level: 2, text: 'C' }]);
});

it('lists the owner markers as pending, and passes when there are none', () => {
  const r = checkOwnerMarkers(makeCtx({ 'README.md': 'a <!-- OWNER:gif --> b <!-- OWNER:live-url -->', 'docs/x-post.md': '<!-- OWNER:gif -->' }));
  expect(r[0]).toMatchObject({ id: 'owner.markers', status: 'pending' });
  expect(r[0]!.detail).toContain('gif');
  expect(r[0]!.detail).toContain('live-url');
  expect(checkOwnerMarkers(makeCtx({ 'README.md': 'nothing' }))[0]!.status).toBe('pass');
});
