import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition } from '../authoring/api';
import { createFakeEditBackend } from './fake-director';

describe('createFakeEditBackend', () => {
  it('scales a layer that exists and says so', async () => {
    let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
    comp = addScene(comp, { id: 's2', durationSec: 3, mode: 'motion', intent: 'x' });
    comp = addLayer(comp, { sceneId: 's2', role: 'caption', kind: 'text', text: 'Hi', box: { x: 0, y: 0, w: 100, h: 50 } });
    const b = createFakeEditBackend(comp);
    const first = await b.chatWithTools([], [], {});
    expect(first.toolCalls[0]?.args).toMatchObject({ layerId: 's2:caption' });
    expect((await b.chatWithTools([], [], {})).content).toContain('s2:caption');
  });

  it('makes no call and does not claim success when there is no text layer', async () => {
    const r = await createFakeEditBackend(newFilmComposition({ aspect: '16:9', title: 'T', palette: [] })).chatWithTools([], [], {});
    expect(r.toolCalls).toEqual([]);
    expect(r.content).toContain('no text layer');
  });
});
