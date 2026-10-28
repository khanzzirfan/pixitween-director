import { expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { allTools } from './registry';

const NAMES = ['addScene', 'setSceneDuration', 'removeScene', 'swapScenes', 'addLayer', 'removeLayer', 'reorderLayer', 'setTransform', 'setKeyframes', 'setText', 'setCamera'];

it('registers exactly the eleven authoring tools', () => {
  const names = allTools().map((t) => t.name);
  expect(names.sort()).toEqual([...NAMES].sort());
});

it('every tool converts to an object JSON schema', () => {
  for (const def of allTools()) {
    const schema = zodToJsonSchema(def.params, { target: 'openApi3', $refStrategy: 'none' }) as { type?: string };
    expect(schema.type, def.name).toBe('object');
  }
});

it('setKeyframes keys are two-number tuples', () => {
  const def = allTools().find((t) => t.name === 'setKeyframes')!;
  const schema = zodToJsonSchema(def.params, { target: 'openApi3', $refStrategy: 'none' }) as { properties: { keys: { items: { type: string; minItems: number; maxItems: number } } } };
  expect(schema.properties.keys.items).toMatchObject({ type: 'array', minItems: 2, maxItems: 2 });
});
