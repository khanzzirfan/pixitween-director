import { expect, it } from 'vitest';
import { parseAepCompositionSafe } from 'reacthub-pixitweenjs';
import { lightValidate } from '../../server/engine/light-validator';

const files = import.meta.glob('../../fixtures/s02/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

it('finds all thirteen fixtures', () => expect(Object.keys(files)).toHaveLength(13));

it.each(Object.entries(files))('engine schema and light validator agree on %s', (name, json) => {
  const engine = parseAepCompositionSafe(json).success;
  expect(lightValidate(json).ok).toBe(engine);
  expect(engine).toBe(name.includes('/valid/'));
});
