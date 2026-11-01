// Owned by Catalog Crew C1. A feed's image_link turned into photo bytes, and the cut-out cache
// that makes a second run of the same feed cost nothing.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { z } from 'zod';

/** A link is only read from the repo under these folders. */
const REPO_PREFIXES = ['fixtures/', 'data/assets/'];

/** The photo a row needs, or the reason it has none. */
export type PhotoResult = Buffer | { error: string };

/** A file name without its extension: 'can-product.png' -> 'can-product'. */
const stem = (name: string): string => {
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
};

/**
 * The uploaded photo that stands in for a link: the one whose name is the link's file name, or
 * the closest match of it, so an uploaded 'can.png' stands in for the repo's 'can-product.png'.
 * The most specific name wins, so an exact file name beats a shorter stem.
 */
function findUpload(link: string, uploads: Map<string, Buffer>): Buffer | undefined {
  const wanted = stem(basename(link));
  let best: { bytes: Buffer; len: number } | undefined;
  for (const [name, bytes] of uploads) {
    const s = stem(name);
    if (s !== wanted && !wanted.startsWith(`${s}-`) && !wanted.startsWith(`${s}_`)) continue;
    if (!best || s.length > best.len) best = { bytes, len: s.length };
  }
  return best?.bytes;
}

/**
 * Turns a feed's image_link into photo bytes.
 *
 * An uploaded photo wins (the owner sent the photo the feed names), then a remote link is
 * refused (nothing here reaches the network), then a repo path under `fixtures/` or
 * `data/assets/` is read from the repo root. An absolute path or one with `..` never reaches
 * the disk: the row fails with `photo not found: <link>`.
 */
export function resolvePhoto(link: string, uploads: Map<string, Buffer>, repoRoot = process.cwd()): PhotoResult {
  const upload = findUpload(link, uploads);
  if (upload) return upload;
  if (/^https?:\/\//i.test(link)) return { error: 'remote photos are not supported yet' };
  if (isAbsolute(link) || link.includes('..') || !REPO_PREFIXES.some((p) => link.startsWith(p))) {
    return { error: `photo not found: ${link}` };
  }
  try {
    return readFileSync(join(repoRoot, link));
  } catch {
    return { error: `photo not found: ${link}` };
  }
}

/** The key a photo is cached under: the sha256 of its bytes, so the same photo cuts out once. */
export function photoKey(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A cut-out of a photo: the asset, its size and the colour the photo carries. */
export const cutoutEntrySchema = z.object({
  id: z.string().min(1),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  accent: z.string().min(1),
  chroma: z.number(),
});
export type CutoutEntry = z.infer<typeof cutoutEntrySchema>;

export interface CutoutCache {
  get(key: string): Promise<CutoutEntry | undefined>;
  set(key: string, entry: CutoutEntry): Promise<void>;
}

/**
 * Cut-outs held in memory only. The fake art uses it, so a fake run never leaves a placeholder
 * cut-out in the disk cache where a later real run would find it and skip the paid SAM call.
 */
export function createMemoryCutoutCache(): CutoutCache {
  const all = new Map<string, CutoutEntry>();
  return {
    async get(key) {
      return all.get(key);
    },
    async set(key, entry) {
      all.set(key, cutoutEntrySchema.parse(entry));
    },
  };
}

/**
 * The cut-outs of a data dir, kept in `<dir>/catalogs/cutouts.json`. The file is read once per
 * instance and written after every set, so a second run of the same feed finds the cut-outs it
 * paid for and spends nothing.
 */
export function createCutoutCache(dir: string): CutoutCache {
  const file = join(dir, 'catalogs', 'cutouts.json');
  let loading: Promise<Record<string, CutoutEntry>> | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  /** Serialise every write, so two sets cannot lose one (the film-store mutex). */
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }

  /** The file, read once. A broken file is an empty cache, not a crash. */
  function load(): Promise<Record<string, CutoutEntry>> {
    loading ??= readFile(file, 'utf8')
      .then((text) => z.record(cutoutEntrySchema).parse(JSON.parse(text) as unknown))
      .catch(() => ({}));
    return loading;
  }

  async function write(all: Record<string, CutoutEntry>): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(all));
    await rename(tmp, file);
  }

  return {
    async get(key) {
      const all = await load();
      return all[key];
    },
    async set(key, entry) {
      return locked(async () => {
        const all = await load();
        all[key] = cutoutEntrySchema.parse(entry);
        await write(all);
      });
    },
  };
}
