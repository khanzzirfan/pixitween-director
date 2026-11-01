import { expect, it } from 'vitest';
import type { FilmState } from '@shared/composition';
import type { Storyboard } from '@shared/storyboard';
import { buildProposalInfo, countGenerateScenes, setSceneMode } from './mode';
import { buildComp } from './test-helpers';

const film = (scenes: Array<Record<string, unknown>> = []) => ({ id: 'film_aaaaaaaaaaaa', aspect: '16:9', storyboard: scenes.length ? ({ scenes } as unknown as Storyboard) : undefined, brief: { text: '', productAssetId: 'p' }, assets: [], version: 1, status: 'ready', costUsd: 0, clippyCredits: 0, createdAt: '' }) as FilmState;

it('counts and flips modes without mutating', () => {
  const c = buildComp([{ id: 's1' }, { id: 's2', mode: 'generate' }, { id: 's3', mode: 'generate' }]);
  expect(countGenerateScenes(c)).toBe(2);
  const flipped = setSceneMode(c, 's1', 'generate');
  expect((flipped.meta as any).director.scenes.s1.mode).toBe('generate');
  expect((c.meta as any).director.scenes.s1.mode).toBe('motion');
  expect(() => setSceneMode(c, 'nope', 'generate')).toThrow(expect.objectContaining({ code: 'unknown_scene' }));
});
it('builds proposal facts', () => {
  const comp = buildComp([{ id: 's1', frames: 90 }]);
  expect(buildProposalInfo({ film: film([{ id: 's1', durationSec: 3, intent: 'coffee pours', modeReason: 'Needs real liquid motion' }]), comp, sceneId: 's1', sourceKind: 'still' })).toMatchObject({
    model: 'fast-h3-omni', durationSec: 5.875, withSound: true, estCredits: 25, reason: 'Needs real liquid motion',
  });
  expect(buildProposalInfo({ film: film([{ id: 's1', durationSec: 3, intent: 'a slow reveal', modeReason: '' }]), comp, sceneId: 's1', sourceKind: 'still' })).toMatchObject({
    model: 'fast-h3', durationSec: 5.2, withSound: false, reason: 'You chose real video for this scene.',
  });
  expect(buildProposalInfo({ film: film(), comp, sceneId: 's1', sourceKind: 'product-photo' }).reason).toContain('No scene image exists yet');
});
