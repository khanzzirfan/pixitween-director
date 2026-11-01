import { expect, it } from 'vitest';
import { aepCompositionSchema, parseAepComposition, parseAepCompositionSafe } from '@shared/aep';
import { aepToMotion } from './motion/aep';
import { parseMotionDoc } from '@engine/schema';

it('exports the public schema pieces and the motion adapter', () => {
  expect(typeof parseAepComposition).toBe('function');
  expect(typeof parseAepCompositionSafe).toBe('function');
  expect(typeof aepCompositionSchema).toBe('object');
  expect(typeof aepToMotion).toBe('function');
  expect(typeof parseMotionDoc).toBe('function');
});
