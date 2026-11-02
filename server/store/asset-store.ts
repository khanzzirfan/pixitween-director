import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Buffer } from 'node:buffer';
import { ASSET_ID_RE, type AssetRef } from '@shared/composition';
import type { AssetStore } from '@shared/ports';
import { getDb } from '../db/open';
import { imageSize } from '../media/image';

export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class AssetTooLargeError extends Error {
  constructor(size: number, max: number) {
    super(`asset of ${size} bytes exceeds the ${max} byte limit`);
    this.name = 'AssetTooLargeError';
  }
}
export class UnsupportedMimeError extends Error {
  constructor(mime: string) {
    super(`unsupported asset type '${mime}'`);
    this.name = 'UnsupportedMimeError';
  }
}
export class AssetNotFoundError extends Error {
  constructor(id: string) {
    super(`asset not found: ${id}`);
    this.name = 'AssetNotFoundError';
  }
}

export const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
};

export interface AssetStoreOptions {
  dir: string;
  publicBaseUrl: string;
  maxUploadBytes?: number;
}

export type FileAssetStore = AssetStore & {
  get(id: string): Promise<AssetRef>;
  has(id: string): Promise<boolean>;
  absoluteUrl(id: string): string;
  list(): Promise<AssetRef[]>;
};

export function createAssetStore(opts: AssetStoreOptions): FileAssetStore {
  const dir = join(opts.dir, 'assets');
  const max = opts.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const base = opts.publicBaseUrl.replace(/\/$/, '');
  const url = (id: string) => `/api/assets/${id}`;

  const checkId = (id: string) => {
    if (!ASSET_ID_RE.test(id)) throw new AssetNotFoundError(String(id));
  };
  const db = getDb(opts.dir);
  const readMeta = (id: string): Omit<AssetRef, 'url'> => {
    checkId(id);
    const row = db.prepare('SELECT meta_json FROM assets WHERE id = ?').get(id) as { meta_json: string } | undefined;
    if (!row) throw new AssetNotFoundError(id);
    return JSON.parse(row.meta_json) as Omit<AssetRef, 'url'>;
  };
  const atomicWrite = async (file: string, data: Buffer | string) => {
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  };

  return {
    async put(bytes, mime, meta = {}) {
      const ext = EXT[mime];
      if (!ext) throw new UnsupportedMimeError(mime);
      if (bytes.length > max) throw new AssetTooLargeError(bytes.length, max);
      await mkdir(dir, { recursive: true });
      const id = `ast_${randomBytes(16).toString('hex')}`;
      const ref: Omit<AssetRef, 'url'> = { ...meta, id, mime };
      if (mime.startsWith('image/')) {
        const size = await imageSize(bytes);
        ref.width = size.width;
        ref.height = size.height;
      }
      // Bytes first: a crash leaves an orphan file, never a row pointing at nothing.
      await atomicWrite(join(dir, `${id}.${ext}`), bytes);
      db.prepare('INSERT INTO assets (id, mime, file, bytes, created_at, meta_json) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        mime,
        `${id}.${ext}`,
        bytes.length,
        new Date().toISOString(),
        JSON.stringify(ref),
      );
      return { ...ref, url: url(id) };
    },
    async read(id) {
      const ref = readMeta(id);
      return readFile(join(dir, `${id}.${EXT[ref.mime]}`));
    },
    url,
    absoluteUrl: (id) => base + url(id),
    async get(id) {
      return { ...readMeta(id), url: url(id) };
    },
    async has(id) {
      return ASSET_ID_RE.test(id) && !!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(id);
    },
    async list() {
      const rows = db.prepare('SELECT meta_json FROM assets ORDER BY created_at, id').all() as { meta_json: string }[];
      return rows.map((r) => {
        const m = JSON.parse(r.meta_json) as Omit<AssetRef, 'url'>;
        return { ...m, url: url(m.id) };
      });
    },
  };
}
