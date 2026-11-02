import { Buffer } from 'node:buffer';
import type { FilmId } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import type { AssetStore } from '@shared/ports';
import { imageSize } from '../media/image';
import type { VisualFrame } from './visual';

export const MAX_FRAMES = 24;
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const FRAME_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export class FrameInputError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FrameInputError';
  }
}

export interface FrameMeta {
  sceneId: string;
  atSec: number;
}

function sniffMime(b: Buffer): string | undefined {
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

/** Checks a frame upload before anything is stored. Throws FrameInputError with an HTTP-shaped status. */
export function validateFrames(
  files: Array<{ bytes: Buffer; name: string }>,
  meta: unknown,
  o: { sceneIds: string[] },
): Array<{ bytes: Buffer; mime: string; meta: FrameMeta }> {
  if (!files.length) throw new FrameInputError(400, 'frames_required', 'Send at least one frame.');
  if (files.length > MAX_FRAMES) throw new FrameInputError(413, 'too_many_frames', `A review takes at most ${MAX_FRAMES} frames.`);
  if (!Array.isArray(meta) || meta.length !== files.length)
    throw new FrameInputError(400, 'meta_mismatch', `meta must be an array with one entry per frame (${files.length} frames).`);
  return files.map((file, i) => {
    if (file.bytes.length > MAX_FRAME_BYTES) throw new FrameInputError(413, 'frame_too_large', `${file.name} exceeds 4 MB.`);
    const mime = sniffMime(file.bytes);
    if (!mime || !FRAME_MIME.has(mime))
      throw new FrameInputError(415, 'unsupported_media', `${file.name} is not a PNG, JPEG or WebP image.`);
    const m = meta[i] as Partial<FrameMeta> | undefined;
    if (!m || typeof m.sceneId !== 'string' || typeof m.atSec !== 'number' || !Number.isFinite(m.atSec))
      throw new FrameInputError(400, 'bad_meta', `meta entry ${i + 1} needs sceneId and atSec.`);
    if (!o.sceneIds.includes(m.sceneId)) throw new FrameInputError(400, 'unknown_scene', `unknown sceneId '${m.sceneId}'.`);
    return { bytes: file.bytes, mime, meta: { sceneId: m.sceneId, atSec: m.atSec } };
  });
}

/** Stores frames as assets tied to the film, scene and time. Returns the stored frames as review input. */
export async function storeFrames(
  assets: AssetStore,
  filmId: FilmId,
  frames: Array<{ bytes: Buffer; mime: string; meta: FrameMeta }>,
  o: { phase: 'before' | 'after'; batch: string },
): Promise<Array<VisualFrame & { sceneId: string; id: string }>> {
  const stored: Array<VisualFrame & { sceneId: string; id: string }> = [];
  for (const f of frames) {
    const ref = await assets.put(f.bytes, f.mime, {
      role: 'frame',
      sceneId: f.meta.sceneId,
      filmId,
      atSec: f.meta.atSec,
      phase: o.phase,
      batch: o.batch,
    });
    stored.push({ id: ref.id, sceneId: f.meta.sceneId, atSec: f.meta.atSec, image: f.bytes });
  }
  return stored;
}

/** The newest 'before' batch of frames for a scene, read back from the asset store. */
export async function latestFrames(ctx: ToolCtx, sceneId: string): Promise<VisualFrame[]> {
  const refs = (await ctx.assets.list()).filter(
    (a) => a.role === 'frame' && a.filmId === ctx.filmId && a.sceneId === sceneId && a.phase !== 'after',
  );
  if (!refs.length) return [];
  const newest = refs
    .map((a) => a.batch ?? '')
    .sort()
    .at(-1);
  const batch = refs.filter((a) => (a.batch ?? '') === newest).sort((a, b) => (a.atSec ?? 0) - (b.atSec ?? 0));
  return Promise.all(batch.map(async (a) => ({ id: a.id, atSec: a.atSec ?? 0, image: await ctx.assets.read(a.id) })));
}

export { imageSize };
