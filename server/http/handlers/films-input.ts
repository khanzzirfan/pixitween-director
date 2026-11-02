import { Buffer } from 'node:buffer';
import type { Aspect } from '@shared/composition';

export type PhotoMime = 'image/png' | 'image/jpeg' | 'image/webp';
/** How many photos one film takes: the first is the hero, the rest are cut between. */
export const MAX_PHOTOS = 6;

export interface CreateFilmInput {
  /** Zero, one or several photos. With none, the server invents a product photo from the brief. */
  photos: Array<{ bytes: Buffer; mime: PhotoMime }>;
  brief?: string;
  audio?: { bytes: Buffer; mime: string };
  aspect: Aspect;
  title?: string;
}
export class InputError extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InputError';
  }
}
const isFile = (value: unknown): value is File => typeof File !== 'undefined' && value instanceof File;
const bytes = async (file: File) => Buffer.from(await file.arrayBuffer());
function productMime(b: Buffer): PhotoMime | undefined {
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}
/** Every file sent under one name: a single value or a list. */
const filesOf = (value: unknown): File[] => (Array.isArray(value) ? value : [value]).filter(isFile).filter((f) => f.size > 0);

export async function parseCreateFilm(body: Record<string, unknown>, o: { maxBytes: number }): Promise<CreateFilmInput> {
  const files = [...filesOf(body.product), ...filesOf(body.photos)];
  if (files.length > MAX_PHOTOS) throw new InputError(400, 'too_many_photos', `Use at most ${MAX_PHOTOS} photos.`);
  const photos: CreateFilmInput['photos'] = [];
  for (const file of files) {
    const data = await bytes(file);
    const mime = productMime(data);
    if (!mime) throw new InputError(415, 'unsupported_media', 'Use a PNG, JPEG or WebP photo.');
    if (data.length > o.maxBytes) throw new InputError(413, 'too_large', 'The uploaded file exceeds the size limit.');
    photos.push({ bytes: data, mime });
  }
  const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
  const audioFile = isFile(body.audio) && body.audio.size > 0 ? body.audio : undefined;
  if (!!brief === !!audioFile) throw new InputError(400, 'brief_or_audio', 'Provide either a text brief or a voice brief.');
  if (brief.length > 2000) throw new InputError(400, 'brief_too_long', 'The brief must be 2000 characters or fewer.');
  const aspect = body.aspect === undefined || body.aspect === '' ? '16:9' : body.aspect;
  if (!['16:9', '9:16', '1:1'].includes(String(aspect))) throw new InputError(400, 'bad_aspect', 'Aspect must be 16:9, 9:16 or 1:1.');
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : undefined;
  if (audioFile) {
    const audioMime = audioFile.type.toLowerCase();
    if (!(audioMime.startsWith('audio/') || audioMime === 'video/webm'))
      throw new InputError(415, 'unsupported_media', 'Use a WebM, WAV, MP3 or M4A voice memo.');
    if (audioFile.size > o.maxBytes) throw new InputError(413, 'too_large', 'The uploaded audio exceeds the size limit.');
    return {
      photos,
      audio: { bytes: await bytes(audioFile), mime: audioMime },
      aspect: aspect as Aspect,
      ...(title ? { title } : {}),
    };
  }
  if (!brief) throw new InputError(400, 'brief_or_audio', 'Provide either a text brief or a voice brief.');
  return { photos, brief, aspect: aspect as Aspect, ...(title ? { title } : {}) };
}
