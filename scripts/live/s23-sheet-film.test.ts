import { expect, it } from 'vitest';
import { describe as describeScript, estimateUsd, preflight } from './s23-sheet-film';

it('says it needs the web server on 5199', () => {
  expect(describeScript()).toContain('5199');
});

it('estimates at most 0.15 USD', () => {
  expect(estimateUsd()).toBeLessThanOrEqual(0.15);
  expect(estimateUsd()).toBe(0.1);
});

it('says it needs the API on 8797 too', () => {
  expect(describeScript()).toContain('8797');
});

it('preflight stops with what to start when 5199 or the pictures are not reachable', async () => {
  const down = async () => ({ ok: false });
  await expect(preflight('ast_1', down)).rejects.toThrow(/5199 is not running/);
  const noApi = async (u: string) => ({ ok: !u.includes('/api/assets/') });
  await expect(preflight('ast_1', noApi)).rejects.toThrow(/8797/);
  await expect(preflight('ast_1', async () => ({ ok: true }))).resolves.toBeUndefined();
});
