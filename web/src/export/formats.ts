// Owned by S8a. Recorder format choice and export file names.
export const RECORDER_MIME_PREFERENCE = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const;

export function pickRecorderMime(isTypeSupported: (mime: string) => boolean): string | null {
  return RECORDER_MIME_PREFERENCE.find((m) => isTypeSupported(m)) ?? null;
}

export const extensionForMime = (mime: string): 'webm' | 'mp4' => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

export function exportFileName(title: string, ext: string, now: Date = new Date()): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `${slug || 'film'}-${date}.${ext}`;
}
