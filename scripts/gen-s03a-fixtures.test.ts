import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lightValidate } from '../server/engine/light-validator';
import { buildFixtures, serialise } from './gen-s03a-fixtures';

const jpeg = readFileSync(new URL('../fixtures/s03a/mug-192.jpg', import.meta.url));

it('regenerating in memory equals the committed fixtures', () => {
  for (const [name, comp] of Object.entries(buildFixtures(jpeg))) {
    const committed = readFileSync(new URL(`../fixtures/s03a/valid/${name}.json`, import.meta.url), 'utf8');
    expect(committed, name).toBe(serialise(comp));
    expect(lightValidate(JSON.parse(committed)).ok, name).toBe(true);
  }
});
