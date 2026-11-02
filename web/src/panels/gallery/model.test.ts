import { describe, expect, it } from 'vitest';
import { formatDuration, toGalleryItems } from './model';

const summary = { id: 'f', title: 't', aspect: '16:9' as const, durationSec: 12, thumbUrl: '/t.png', sceneCount: 3, hasGenerated: false, crew: false };

describe('toGalleryItems', () => {
  it('keeps the server order and turns the date into a short label', () => {
    const items = toGalleryItems([{ ...summary, id: 'a', createdAt: '2026-11-02T09:00:00Z' }, { ...summary, id: 'b', createdAt: '' }]);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(items[0]!.createdLabel).not.toBe('');
    expect(items[1]!.createdLabel).toBe('');
    expect(items[0]).not.toHaveProperty('createdAt');
  });
});

describe('formatDuration', () => {
  it('formats m:ss', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(5)).toBe('0:05');
  });
});
