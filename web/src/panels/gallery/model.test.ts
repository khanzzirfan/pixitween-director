import { describe, expect, it } from 'vitest';
import type { FilmState } from '@shared/composition';
import { formatDuration, toGalleryItems } from './model';

const comp = { version: '1.0.0', id: 'c', width: 1, height: 1, fps: 30, durationInFrames: 360, assets: {}, layers: [] };
const scene = (id: string, mode: 'motion' | 'generate') => ({ id, mode, durationSec: 4, intent: 'i', shotType: 'hero', camera: 'static', layersWanted: ['bg'], modeReason: 'r' });
const film = (o: Record<string, unknown>): FilmState =>
  ({ id: 'f', aspect: '16:9', status: 'ready', brief: { text: '', productAssetId: 'ast_p' }, version: 1, assets: [], costUsd: 0, clippyCredits: 0, createdAt: '2026-11-01T10:00:00Z', composition: comp, ...o }) as unknown as FilmState;

const generate = film({ id: 'gen', title: 'Generate film', assets: [{ id: 'ast_p', url: '/thumbs/p.png', mime: 'image/png' }], storyboard: { scenes: [scene('a', 'motion'), scene('b', 'generate'), scene('c', 'motion')] } });
const motion = film({ id: 'mot', title: 'Motion film', createdAt: '2026-11-02T09:00:00Z', storyboard: { scenes: [scene('a', 'motion')] } });
const building = film({ id: 'bld', status: 'building' });

describe('toGalleryItems', () => {
  it('keeps ready films, newest first', () => {
    const items = toGalleryItems([generate, building, motion]);
    expect(items.map((i) => i.id)).toEqual(['mot', 'gen']);
  });
  it('derives the item fields', () => {
    const [mot, gen] = toGalleryItems([generate, motion]);
    expect(gen).toMatchObject({ durationSec: 12, sceneCount: 3, hasGenerated: true, thumbUrl: '/thumbs/p.png', title: 'Generate film' });
    expect(mot!.hasGenerated).toBe(false);
  });
  it('sorts a film without createdAt last, and falls back for thumbnail and title', () => {
    const undated = film({ id: 'und', createdAt: undefined });
    const items = toGalleryItems([undated, generate, motion]);
    expect(items.map((i) => i.id)).toEqual(['mot', 'gen', 'und']);
    expect(items[2]).toMatchObject({ title: 'Untitled film', thumbUrl: '/api/assets/ast_p' });
  });
});

it('formatDuration', () => {
  expect(formatDuration(12)).toBe('0:12');
  expect(formatDuration(75)).toBe('1:15');
  expect(formatDuration(59.6)).toBe('1:00');
});
