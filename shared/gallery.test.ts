import { describe, expect, it } from 'vitest';
import type { FilmState } from './composition';
import { toGallerySummaries } from './gallery';

const comp = { version: '1.0.0', id: 'c', width: 1, height: 1, fps: 30, durationInFrames: 360, assets: {}, layers: [] };
const scene = (id: string, mode: 'motion' | 'generate') => ({ id, mode, durationSec: 4, intent: 'i', shotType: 'hero', camera: 'static', layersWanted: ['bg'], modeReason: 'r' });
const film = (o: Record<string, unknown>): FilmState =>
  ({ id: 'f', aspect: '16:9', status: 'ready', brief: { text: '', productAssetId: 'ast_p' }, version: 1, assets: [], costUsd: 0, clippyCredits: 0, createdAt: '2026-11-01T10:00:00Z', composition: comp, ...o }) as unknown as FilmState;

const generate = film({ id: 'gen', title: 'Generate film', assets: [{ id: 'ast_p', url: '/thumbs/p.png', mime: 'image/png' }], storyboard: { scenes: [scene('a', 'motion'), scene('b', 'generate'), scene('c', 'motion')] } });
const motion = film({ id: 'mot', title: 'Motion film', createdAt: '2026-11-02T09:00:00Z', storyboard: { scenes: [scene('a', 'motion')] } });
const building = film({ id: 'bld', status: 'building' });

describe('toGallerySummaries', () => {
  it('keeps ready films, newest first', () => {
    expect(toGallerySummaries([generate, building, motion]).map((i) => i.id)).toEqual(['mot', 'gen']);
  });
  it('derives the summary fields', () => {
    const [mot, gen] = toGallerySummaries([generate, motion]);
    expect(gen).toMatchObject({ durationSec: 12, sceneCount: 3, hasGenerated: true, thumbUrl: '/thumbs/p.png', title: 'Generate film', createdAt: '2026-11-01T10:00:00Z' });
    expect(mot!.hasGenerated).toBe(false);
  });
  it('sorts a film without createdAt last, and falls back for thumbnail and title', () => {
    const items = toGallerySummaries([film({ id: 'und', createdAt: undefined }), generate, motion]);
    expect(items.map((i) => i.id)).toEqual(['mot', 'gen', 'und']);
    expect(items[2]).toMatchObject({ title: 'Untitled film', thumbUrl: '/api/assets/ast_p', createdAt: '' });
  });
  it('carries no composition', () => {
    expect(JSON.stringify(toGallerySummaries([generate]))).not.toContain('layers');
  });
});
