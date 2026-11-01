import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildR8Films, buildR8Layout } from '../../scripts/gen-r8-fixtures';

describe('fixtures/r8', () => {
  it('matches what the authoring code builds now (run `npm run r8:fixtures` after changing a film)', () => {
    for (const [name, film] of Object.entries(buildR8Films())) {
      const stored = JSON.parse(readFileSync(`fixtures/r8/${name}.json`, 'utf8'));
      expect(stored, name).toEqual(JSON.parse(JSON.stringify(film)));
    }
  });

  it('has the layout the e2e probes read', () => {
    expect(JSON.parse(readFileSync('fixtures/r8/layout.json', 'utf8'))).toEqual(JSON.parse(JSON.stringify(buildR8Layout())));
  });
});
