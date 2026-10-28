import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppDeps } from './http/deps';

const modules: Array<[string, string]> = [
  ['./authoring/api', 'S3a'],
  ['./agent/director', 'S3b'],
  ['./agent/storyboard', 'S3b'],
  ['./agent/build-scene', 'S3b'],
  ['./agent/prompts/director', 'S3b'],
  ['./listener', 'S3b'],
  ['./art/cutout', 'S4'],
  ['./art/stills', 'S4'],
  ['./review/rules', 'S5a'],
  ['./review/visual', 'S5b'],
  ['./agent/edit-loop', 'S6'],
  ['./http/handlers/films', 'S3b'],
  ['./http/handlers/chat', 'S6'],
  ['./http/handlers/review', 'S5b'],
  ['./http/handlers/local', 'S9'],
];
// ./tools/authoring (S3a), ./tools/review (S5b) and ./tools/art, ./tools/edit are filled in and no longer stubs
const toolFiles: Array<[string, string]> = [['./tools/generate', 'S7b']];

describe('step modules expose their owner', () => {
  it.each(modules)('%s is owned by %s', async (path, owner) => {
    const module = (await import(/* @vite-ignore */ path)) as { STUB_OWNER?: string };
    expect(module.STUB_OWNER).toBe(owner);
  });
  it.each(toolFiles)('%s exports an empty tools array', async (path) => {
    expect(((await import(/* @vite-ignore */ path)) as { tools: unknown[] }).tools).toEqual([]);
  });
});

describe('remaining handler stubs answer 501 with their owner', async () => {
  const app = new Hono();
  const deps = {} as AppDeps;
  (await import('./http/handlers/review')).registerReviewRoutes(app, deps);
  (await import('./http/handlers/local')).registerLocalRoutes(app, deps);
  const rows: Array<[string, string, string]> = [
    ['GET', '/api/local-mode', 'S9'],
    ['PUT', '/api/local-mode', 'S9'],
  ];
  it.each(rows)('%s %s -> 501 %s', async (method, path, owner) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'not_implemented', owner });
  });
});
