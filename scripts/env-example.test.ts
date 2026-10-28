import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ENV_KEYS } from '../server/env';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const example = read('.env.example');
const readme = read('README.md');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

it('lists every env name at the start of a line', () => {
  for (const key of ENV_KEYS) expect(example, key).toMatch(new RegExp(`^${key}=`, 'm'));
});

it('keeps the secrets empty', () => {
  for (const key of ['META_API_KEY', 'MODEL_API_KEY', 'CLIPPY_TOKEN', 'BASETEN_API_KEY', 'DIRECTOR_PASSCODE']) {
    expect(example, key).toMatch(new RegExp(`^${key}=$`, 'm'));
  }
});

it('README mentions every script and the SAM License', () => {
  for (const name of Object.keys(pkg.scripts)) {
    const forms = name === 'test' ? ['npm test', 'npm run test'] : [`npm run ${name}`];
    expect(forms.some((f) => readme.includes(f)), name).toBe(true);
  }
  expect(readme).toContain('SAM License');
});

it('README ends with the S10 marker', () => {
  expect(readme.trimEnd().endsWith('<!-- S10 completes: Built during the hackathon / Pre-existing dependencies -->')).toBe(true);
});
