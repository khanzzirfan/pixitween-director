import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const text = readFileSync(new URL('../docs/crew.md', import.meta.url), 'utf8');

it('has the six headings the README links to', () => {
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  for (const h of ['The crew', 'How jobs run', 'Blind critic', 'Takes', 'Replay', 'Measured']) expect(headings).toContain(h);
});

it('links to no gitignored folder and names no private repository', () => {
  expect(text).not.toMatch(/docs\/hackathon|docs\/learn-improve|\(\.\.\/\.\.\//);
});

it('marks every number that has no recorded run as to be measured', () => {
  expect(text.match(/to be measured/g)?.length).toBeGreaterThanOrEqual(3);
});
