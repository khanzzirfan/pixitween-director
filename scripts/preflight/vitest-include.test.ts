import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The preflight and cost tests live under scripts/, so the test config must include that folder (decision D-9). This only asserts it; the config is not edited here.
it('covers scripts/**/*.test.ts in the node test project', () => {
  const config = readFileSync(new URL('../../vitest.config.ts', import.meta.url), 'utf8');
  expect(config).toContain("'scripts/**/*.test.ts'");
});
