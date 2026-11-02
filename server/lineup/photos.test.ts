import type * as FsModule from 'node:fs';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { resolvePhoto } from './photos';

/** Every file the resolver reads, so a test can prove it read none. */
const reads = vi.hoisted(() => [] as string[]);

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>();
  return {
    ...actual,
    default: actual,
    readFileSync: ((file: string, ...rest: unknown[]) => {
      reads.push(String(file));
      return (actual.readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
    }) as typeof actual.readFileSync,
  };
});

const CAN = 'fixtures/s13/can-product.png';

beforeEach(() => {
  reads.length = 0;
});

it('resolves a repo photo to its bytes', () => {
  const got = resolvePhoto(CAN, new Map());
  expect(Buffer.isBuffer(got)).toBe(true);
  expect((got as Buffer).length).toBe(statSync(CAN).size);
});

it('prefers an uploaded photo over the repo path', () => {
  const upload = Buffer.from('the uploaded can');
  const got = resolvePhoto(CAN, new Map([['can.png', upload]]));
  expect(got).toEqual(upload);
  expect(reads).toEqual([]);
});

it('prefers the upload whose name is the photo it stands in for', () => {
  const exact = Buffer.from('exact');
  const got = resolvePhoto(CAN, new Map([['can.png', Buffer.from('loose')], ['can-product.png', exact]]));
  expect(got).toEqual(exact);
});

it('reads a repo photo from the repo root it is given', () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-photos-'));
  mkdirSync(join(root, 'fixtures'), { recursive: true });
  writeFileSync(join(root, 'fixtures', 'x.png'), 'the photo');
  expect(resolvePhoto('fixtures/x.png', new Map(), root)).toEqual(Buffer.from('the photo'));
});

it('refuses a link that leaves the repo and reads no file', () => {
  expect(resolvePhoto('../secret.png', new Map())).toEqual({ error: 'photo not found: ../secret.png' });
  expect(resolvePhoto('../etc/passwd', new Map())).toEqual({ error: 'photo not found: ../etc/passwd' });
  expect(resolvePhoto('/etc/passwd', new Map())).toEqual({ error: 'photo not found: /etc/passwd' });
  expect(resolvePhoto('data/../secret.png', new Map())).toEqual({ error: 'photo not found: data/../secret.png' });
  expect(reads).toEqual([]);
});

it('refuses a photo outside the folders the repo keeps them in', () => {
  expect(resolvePhoto('etc/passwd', new Map())).toEqual({ error: 'photo not found: etc/passwd' });
  expect(resolvePhoto('package.json', new Map())).toEqual({ error: 'photo not found: package.json' });
  expect(reads).toEqual([]);
});

it('refuses a remote photo', () => {
  expect(resolvePhoto('https://x.test/a.png', new Map())).toEqual({ error: 'remote photos are not supported yet' });
  expect(resolvePhoto('http://x.test/a.png', new Map())).toEqual({ error: 'remote photos are not supported yet' });
  expect(reads).toEqual([]);
});

it('says a repo photo that is not there is not found', () => {
  expect(resolvePhoto('fixtures/nope.png', new Map())).toEqual({ error: 'photo not found: fixtures/nope.png' });
  expect(reads).toHaveLength(1);
});
