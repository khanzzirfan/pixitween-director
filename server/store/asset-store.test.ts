import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readSeedBuffer } from '../test-utils/fixtures';
import { AssetNotFoundError, AssetTooLargeError, UnsupportedMimeError, createAssetStore } from './asset-store';

const mk = (o: { maxUploadBytes?: number } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'assets-'));
  return { dir, store: createAssetStore({ dir, publicBaseUrl: 'https://d.example/', ...o }) };
};

it('stores, describes and reads an image', async () => {
  const { store } = mk();
  const bytes = readSeedBuffer('mug-product.png');
  const ref = await store.put(bytes, 'image/png', { role: 'product-photo', sceneId: 's1' });
  expect(ref.id).toMatch(/^ast_[a-f0-9]{32}$/);
  expect(ref.url).toBe(`/api/assets/${ref.id}`);
  const got = await store.get(ref.id);
  expect(got).toMatchObject({ width: 384, mime: 'image/png', role: 'product-photo', sceneId: 's1' });
  expect((await store.read(ref.id)).equals(bytes)).toBe(true);
  expect(store.absoluteUrl(ref.id)).toBe(`https://d.example/api/assets/${ref.id}`);
  expect(await store.has(ref.id)).toBe(true);
  expect((await store.list()).map((r) => r.id)).toEqual([ref.id]);
});

it('rejects oversize and unsupported uploads and writes nothing', async () => {
  const { store, dir } = mk({ maxUploadBytes: 1024 });
  await expect(store.put(Buffer.alloc(2048), 'image/png')).rejects.toBeInstanceOf(AssetTooLargeError);
  await expect(store.put(Buffer.alloc(8), 'application/x-sh')).rejects.toBeInstanceOf(UnsupportedMimeError);
  expect(readdirSync(dir)).toEqual([]);
  await expect(mk().store.put(Buffer.alloc(26 * 1024 * 1024), 'video/mp4')).rejects.toBeInstanceOf(AssetTooLargeError);
});

it('refuses malformed ids', async () => {
  const { store } = mk();
  for (const id of ['../etc/passwd', 'ast_zz', 'ast_0123456789abcdef', 'ast_' + 'a'.repeat(32)]) {
    await expect(store.read(id)).rejects.toBeInstanceOf(AssetNotFoundError);
  }
  expect(await store.has('../x')).toBe(false);
});
