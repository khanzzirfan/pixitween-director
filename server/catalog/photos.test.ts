import type * as FsModule from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { createCutoutCache, photoKey, resolvePhoto } from './photos';

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

it('keys a photo by the sha256 of its bytes', () => {
  const key = photoKey(Buffer.from('can'));
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(photoKey(Buffer.from('can'))).toBe(key);
  expect(photoKey(Buffer.from('mug'))).not.toBe(key);
});

it('gives a cut-out cached in one cache to a new cache on the same dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-cut-'));
  const entry = { id: 'asset_1', width: 100, height: 200, accent: '#3d4a5c', chroma: 0.42 };
  await createCutoutCache(dir).set('key1', entry);
  expect(existsSync(join(dir, 'catalogs', 'cutouts.json'))).toBe(true);
  expect(await createCutoutCache(dir).get('key1')).toEqual(entry);
});

it('keeps every cut-out it is given', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-cut-'));
  const cache = createCutoutCache(dir);
  await cache.set('key1', { id: 'asset_1', width: 10, height: 20, accent: '#111111', chroma: 0.1 });
  await cache.set('key2', { id: 'asset_2', width: 30, height: 40, accent: '#222222', chroma: 0.2 });
  const other = createCutoutCache(dir);
  expect(await other.get('key1')).toEqual({ id: 'asset_1', width: 10, height: 20, accent: '#111111', chroma: 0.1 });
  expect(await other.get('key2')).toEqual({ id: 'asset_2', width: 30, height: 40, accent: '#222222', chroma: 0.2 });
  expect(await other.get('nope')).toBeUndefined();
});
