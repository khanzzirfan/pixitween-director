import type { Buffer } from 'node:buffer';
import type { MetaClients } from '@shared/ports';
import { toWav16kMono } from './media/ffmpeg';
import { NotImplementedError } from './errors';

export const STUB_OWNER = 'S3b' as const;
export const MAX_BRIEF_SECONDS = 60;
export class BriefTooLongError extends Error {
  constructor() {
    super('audio brief exceeds 60 seconds');
    this.name = 'BriefTooLongError';
  }
}
export class EmptyBriefError extends Error {
  constructor() {
    super('audio brief transcript is empty');
    this.name = 'EmptyBriefError';
  }
}

export async function transcribeBrief(
  audio: Buffer,
  o?: { meta: MetaClients; keywords?: string[]; convert?: (b: Buffer) => Promise<Buffer> },
): Promise<{ text: string; audioDurationMs: number }> {
  if (!o) throw new NotImplementedError('S3b');
  const wav = await (o.convert ?? toWav16kMono)(audio);
  const duration = Math.max(0, (wav.length - 44) / 32000);
  if (duration > MAX_BRIEF_SECONDS) throw new BriefTooLongError();
  const result = await o.meta.transcribe.file(wav, { keywords: o.keywords });
  const text = result.transcript.trim();
  if (!text) throw new EmptyBriefError();
  return { text, audioDurationMs: result.audioDurationMs ?? duration * 1000 };
}
