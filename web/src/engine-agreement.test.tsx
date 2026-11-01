import { expect, it } from 'vitest';
import { parseAepCompositionSafe } from '@shared/aep';
import { aepToMotion } from './motion/aep';
import { lightValidate } from '../../server/engine/light-validator';

const files = import.meta.glob('../../fixtures/s02/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

it('finds all thirteen fixtures', () => expect(Object.keys(files)).toHaveLength(13));

it.each(Object.entries(files))('engine schema and light validator agree on %s', (name, json) => {
  const engine = parseAepCompositionSafe(json).success;
  expect(lightValidate(json).ok).toBe(engine);
  expect(engine).toBe(name.includes('/valid/'));
});

const valid = Object.entries(files).filter(([name]) => name.includes('/valid/'));

it.each(valid)('aepToMotion converts valid fixture %s', (_name, json) => {
  const parsed = parseAepCompositionSafe(json);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const { doc } = aepToMotion(parsed.data);
  expect(doc.layers.length).toBeGreaterThan(0);
});
