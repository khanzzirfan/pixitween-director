import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkReadmeLinks, linkTargets } from './links';

const ctx = (readme: string, tracked: string[]) => makeCtx({ 'README.md': readme }, { tracked: ['README.md', ...tracked] });

it('passes for a tracked path and fails, naming the path, for one that is not', () => {
  expect(checkReadmeLinks(ctx('[spark](server/meta/spark.ts)', ['server/meta/spark.ts']))[0]!.status).toBe('pass');
  const r = checkReadmeLinks(ctx('[spark](server/meta/spark.ts)', []))[0]!;
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('server/meta/spark.ts');
});

it('never fails for a web link, a mailto link or an anchor', () => {
  expect(checkReadmeLinks(ctx('[a](https://example.com) [b](mailto:a@b.c) [c](#architecture)', []))[0]!.status).toBe('pass');
});

it('accepts a path with an anchor when the file is tracked, and a tracked folder', () => {
  expect(checkReadmeLinks(ctx('[a](docs/architecture.md#film-lifecycle) [b](server/)', ['docs/architecture.md', 'server/main.ts']))[0]!.status).toBe('pass');
});

it('ignores links inside code fences', () => {
  expect(linkTargets('```\n[x](nope.md)\n```\n[y](ok.md)')).toEqual(['ok.md']);
});

it('fails when there is no README', () => {
  expect(checkReadmeLinks(makeCtx({}))[0]!.status).toBe('fail');
});
