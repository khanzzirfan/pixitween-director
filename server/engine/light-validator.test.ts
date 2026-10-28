import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../test-utils/fixtures';
import { lightValidate } from './light-validator';
import { getValidator } from './validate';

const load = (dir: string, f: string) => JSON.parse(readFileSync(fixturePath('s02', `${dir}/${f}`), 'utf8'));
const files = (dir: string) => readdirSync(fixturePath('s02', dir)).filter((f) => f.endsWith('.json'));

describe('valid fixtures', () => {
  it('has the five hand-made files', () => expect(files('valid')).toHaveLength(5));
  it.each(files('valid'))('%s passes', (f) => {
    const r = lightValidate(load('valid', f));
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe('invalid fixtures', () => {
  const expected: Record<string, RegExp> = {
    'dup-id.json': /duplicate|unique/,
    'dangling-parent.json': /parent/,
    'parent-cycle.json': /cycle/,
    'unknown-comp.json': /compId/,
    'missing-asset.json': /assetId/,
    'bad-version.json': /version/,
    'negative-size.json': /size|width/,
    'opacity-2.json': /opacity/,
  };
  it('has the eight files', () => expect(files('invalid').sort()).toEqual(Object.keys(expected).sort()));
  it.each(Object.entries(expected))('%s fails mentioning the fault', (f, re) => {
    const r = lightValidate(load('invalid', f));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.some((i) => re.test(i.message))).toBe(true);
  });
});

it('scene-precomp passes only because the inner comp declares its own assets', () => {
  const c = load('valid', 'scene-precomp.json');
  expect(lightValidate(c).ok).toBe(true);
  c.precomps.scene1.assets = {};
  const r = lightValidate(c);
  expect(!r.ok && r.issues.some((i) => i.message.includes('assetId'))).toBe(true);
});

it('getValidator falls back to the light validator', async () => {
  expect((await getValidator()).name).toBe('light');
});
