import { describe, expect, it } from 'vitest';
import { RECORDER_MIME_PREFERENCE, exportFileName, extensionForMime, pickRecorderMime } from './formats';

describe('pickRecorderMime', () => {
  it('takes the first supported entry', () => {
    expect(pickRecorderMime(() => true)).toBe('video/webm;codecs=vp9,opus');
    expect(pickRecorderMime((m) => m === 'video/webm;codecs=vp8')).toBe('video/webm;codecs=vp8');
    expect(pickRecorderMime((m) => m === 'video/mp4')).toBe('video/mp4');
    expect(pickRecorderMime(() => false)).toBeNull();
  });
  it('keeps the documented order', () => expect(RECORDER_MIME_PREFERENCE).toHaveLength(6));
});
it('extensionForMime', () => {
  expect(extensionForMime('video/webm;codecs=vp9,opus')).toBe('webm');
  expect(extensionForMime('video/mp4')).toBe('mp4');
});
describe('exportFileName', () => {
  const day = new Date('2026-11-02T12:00:00Z');
  it('slugs the title', () => expect(exportFileName('Morning Ritual — White Mug!', 'webm', day)).toBe('morning-ritual-white-mug-20261102.webm'));
  it('falls back to film', () => expect(exportFileName('', 'mp4', day)).toBe('film-20261102.mp4'));
  it('caps the slug at 40 characters', () => {
    const name = exportFileName('a'.repeat(100), 'webm', day);
    expect(name.replace('-20261102.webm', '').length).toBeLessThanOrEqual(40);
  });
});
