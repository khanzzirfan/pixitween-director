import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FilmState } from '@shared/composition';
import { BLOCK_NUDGE, BUILD_NUDGE, CAST_NUDGE, PLAN_NUDGE, cartoonNeed, planNudgeText } from '../crew/showrunner';

const scene = { id: 's1' } as never;
const film = (o: Partial<FilmState>): FilmState => ({ storyboard: { scenes: [scene] }, ...o }) as unknown as FilmState;
const member = (kind: 'character' | 'set') => ({ id: kind, kind, name: kind, description: '', status: 'ready' as const });

afterEach(() => vi.unstubAllEnvs());

describe('the idle nudges of a toy-studio film', () => {
  it('asks for the plan, then the cast, then the shots', () => {
    vi.stubEnv('CARTOON_MODE', 'true');
    expect(planNudgeText(film({ storyboard: { scenes: [] } } as never))).toBe(PLAN_NUDGE);
    expect(planNudgeText(film({}))).toBe(CAST_NUDGE);
    expect(planNudgeText(film({ cast: [member('character'), member('set')] }))).toBe(BLOCK_NUDGE);
  });

  it('needs nothing once every scene has a stage', () => {
    vi.stubEnv('CARTOON_MODE', 'true');
    const composition = { precomps: { s1: { layers: [{ kind: 'stage3d' }] } } } as never;
    expect(cartoonNeed(film({ cast: [member('character'), member('set')], composition }))).toBeUndefined();
  });

  it('leaves a classic film alone', () => {
    vi.stubEnv('CARTOON_MODE', 'false');
    expect(cartoonNeed(film({}))).toBeUndefined();
    expect(planNudgeText(film({}))).toBe(BUILD_NUDGE);
  });
});
