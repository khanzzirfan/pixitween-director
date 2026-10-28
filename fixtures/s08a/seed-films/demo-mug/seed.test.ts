import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseAepCompositionSafe } from 'reacthub-pixitweenjs';

// jsdom gives import.meta.url a non-file form, so resolve from the repository root (vitest runs there)
const dir = `${process.cwd()}/fixtures/s08a/seed-films/demo-mug/`;
const seed = JSON.parse(readFileSync(`${dir}seed.json`, 'utf8'));

it('has a ready film with three scenes, one generated', () => {
  expect(seed.film.status).toBe('ready');
  expect(seed.film.storyboard.scenes).toHaveLength(3);
  expect(seed.film.storyboard.scenes.filter((s: { mode: string }) => s.mode === 'generate')).toHaveLength(1);
});
it('references an existing product photo', () => expect(existsSync(`${dir}${seed.assets[0].file}`)).toBe(true));
it('parses with the real schema, with or without the placeholder', () => {
  const substituted = JSON.parse(JSON.stringify(seed.film.composition).replaceAll('{{asset:mug-product}}', '/api/assets/x'));
  const r = parseAepCompositionSafe(substituted);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  expect(parseAepCompositionSafe(seed.film.composition).success).toBe(true);
});
