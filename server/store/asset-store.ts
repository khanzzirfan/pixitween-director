import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Buffer } from 'node:buffer';
import { ASSET_ID_RE, type AssetRef } from '@shared/composition';
import type { AssetStore } from '@shared/ports';
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
  const readMeta = async (id: string): Promise<Omit<AssetRef, 'url'>> => {
    checkId(id);
    try {
      return JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')) as Omit<AssetRef, 'url'>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new AssetNotFoundError(id);
      throw e;
    }
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
      await atomicWrite(join(dir, `${id}.${ext}`), bytes);
      await atomicWrite(join(dir, `${id}.json`), JSON.stringify(ref));
      return { ...ref, url: url(id) };
    },
    async read(id) {
      const ref = await readMeta(id);
      return readFile(join(dir, `${id}.${EXT[ref.mime]}`));
    },
    url,
    absoluteUrl: (id) => base + url(id),
    async get(id) {
      return { ...(await readMeta(id)), url: url(id) };
    },
    async has(id) {
      if (!ASSET_ID_RE.test(id)) return false;
      return stat(join(dir, `${id}.json`)).then(
        () => true,
        () => false,
      );
    },
    async list() {
      const names = await readdir(dir).catch(() => [] as string[]);
      const refs = await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => this.get(n.slice(0, -5))));
      return refs;
    },
  };
}
