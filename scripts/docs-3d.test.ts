import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const text = readFileSync(new URL('../docs/3d.md', import.meta.url), 'utf8');

it('has the headings the README links to', () => {
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  for (const h of ['Motion, 3D or Generate', 'A label from the photo', 'Why 35 degrees', 'The model3d layer', 'Measured']) expect(headings).toContain(h);
});

it('links to no gitignored folder', () => {
  expect(text).not.toMatch(/docs\/hackathon|docs\/learn-improve/);
});

it('marks what has no recorded run as to be measured', () => {
  expect(text.match(/to be measured/g)?.length).toBeGreaterThanOrEqual(3);
});
