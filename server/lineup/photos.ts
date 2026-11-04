// A feed's image_link turned into photo bytes: an uploaded photo, or a repo path under fixtures/ or data/assets/.
import { readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';

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
