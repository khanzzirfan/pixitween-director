import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { scanDirectory } from './check-bundle';

const opts = { forbiddenNames: ['META_API_KEY'], forbiddenValues: [] as string[] };
const dirWith = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  writeFileSync(join(dir, 'a.js'), text);
  return dir;
};

it('is clean for innocent code', () => expect(scanDirectory(dirWith('console.log(1)'), opts)).toEqual([]));
it('flags a key name', () => expect(scanDirectory(dirWith('x="META_API_KEY"'), opts)[0]?.kind).toBe('name'));
it('flags a bearer token', () => expect(scanDirectory(dirWith('h="Bearer abc"'), opts).map((f) => f.kind)).toContain('bearer'));
it('flags a planted env value', () =>
  expect(scanDirectory(dirWith('v="supersecretvalue123"'), { ...opts, forbiddenValues: ['supersecretvalue123'] })[0]?.kind).toBe('value'));
