import { describe, expect, it } from 'vitest';
import { runRules } from '../../review/rules';
import { makeTestFilm } from '../../test-utils/film';
import { runTool } from '../../tools/registry';
import { snapText } from './builder';

describe('snapText', () => {
  it('moves text that sticks out of the safe area back inside, with no model', async () => {
    const t = await makeTestFilm({ aspect: '9:16' });
    await runTool(t.ctx, 'addScene', { id: 's1', durationSec: 4 });
    await runTool(t.ctx, 'addLayer', { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#f4ead5' });
    await runTool(t.ctx, 'addLayer', { sceneId: 's1', role: 'headline', kind: 'text', text: 'Cold Brew', style: { size: 120, color: '#222222', align: 'left' } });
    await runTool(t.ctx, 'setTransform', { layerId: 's1:headline', x: 30, y: 300 });
    const comp = async () => (await t.films.get(t.filmId)).composition!;
    const outside = async () => (await runRules(await comp(), { read: (id: string) => t.assets.read(id) }, { sceneIds: ['s1'] })).findings.filter((f) => f.kind === 'outside-safe-area');
    expect((await outside()).length).toBeGreaterThan(0);
    expect(await snapText(t.ctx, 's1', undefined)).toBeGreaterThan(0);
    expect(await outside()).toEqual([]);
  });
});
