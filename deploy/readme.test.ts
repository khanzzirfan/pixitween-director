import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { scanForKeys } from './predeploy-check';

const readme = readFileSync('deploy/README.md', 'utf8');

it('has the sections in order', () => {
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const wanted = ['Prerequisites', 'Pre-deploy checks', 'Create the app', 'Secrets', 'Deploy', 'Verify', 'Seed the gallery', 'Teardown'];
  expect(headings.filter((h) => wanted.includes(h!))).toEqual(wanted);
  expect(headings).toContain('Tuning the crew');
});

it('has the commands that matter', () => {
  for (const s of ['fly launch --no-deploy --copy-config', 'fly volumes create director_data', 'fly apps destroy', '--no-deploy', '16 Nov 2026']) expect(readme).toContain(s);
});

it('shows placeholders, never a key', () => {
  expect(scanForKeys(readme, { serverNames: false })).toEqual([]);
  expect(readme).toContain('<your key>');
});
