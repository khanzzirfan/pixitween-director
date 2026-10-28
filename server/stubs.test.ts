import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { NotImplementedError } from './errors';
import type { AppDeps } from './http/deps';

const FILM = 'film_3fa9c2d41b7e';
const modules: Array<[string, string]> = [
  ['./authoring/api', 'S3a'], ['./agent/director', 'S3b'], ['./agent/prompts/director', 'S3b'], ['./listener', 'S3b'],
  ['./art/cutout', 'S4'], ['./art/stills', 'S4'], ['./review/geometry', 'S5a'], ['./review/rules', 'S5a'], ['./review/visual', 'S5b'],
  ['./agent/edit-loop', 'S6'], ['./clippy/mcp', 'S7a'], ['./generate/approval', 'S7a'], ['./generate/request', 'S7a'], ['./generate/clip-check', 'S7b'],
  ['./http/handlers/films', 'S3b'], ['./http/handlers/chat', 'S6'], ['./http/handlers/review', 'S5b'], ['./http/handlers/generate', 'S7a'], ['./http/handlers/local', 'S9'],
];
// ./tools/authoring is filled in by S3a and no longer a stub
const toolFiles: Array<[string, string]> = [['./tools/art', 'S4'], ['./tools/review', 'S5b'], ['./tools/edit', 'S6'], ['./tools/generate', 'S7b']];

describe('stub modules', () => {
  it.each(modules)('%s is owned by %s', async (path, owner) => {
    expect(((await import(/* @vite-ignore */ path)) as { STUB_OWNER?: string }).STUB_OWNER).toBe(owner);
  });
  it.each(toolFiles)('%s exports an empty tools array', async (path) => {
    expect(((await import(/* @vite-ignore */ path)) as { tools: unknown[] }).tools).toEqual([]);
    void toolFiles;
  });
  it('entry points reject with NotImplementedError', async () => {
    const { runDirector } = await import('./agent/director');
    const { transcribeBrief } = await import('./listener');
    const { runEdit } = await import('./agent/edit-loop');
    const e1 = (await runDirector(FILM).catch((e) => e)) as NotImplementedError;
    expect(e1).toBeInstanceOf(NotImplementedError);
    expect(e1.step).toBe('S3b');
    expect(((await transcribeBrief(Buffer.alloc(1)).catch((e) => e)) as NotImplementedError).step).toBe('S3b');
    expect(((await runEdit(FILM, 'hi').catch((e) => e)) as NotImplementedError).step).toBe('S6');
  });
});

describe('handler stubs answer 501 with their owner', async () => {
  const app = new Hono();
  const deps = {} as AppDeps;
  (await import('./http/handlers/films')).registerFilmsRoutes(app, deps);
  (await import('./http/handlers/chat')).registerChatRoutes(app, deps);
  (await import('./http/handlers/review')).registerReviewRoutes(app, deps);
  (await import('./http/handlers/generate')).registerGenerateRoutes(app, deps);
  (await import('./http/handlers/local')).registerLocalRoutes(app, deps);
  const rows: Array<[string, string, string]> = [
    ['POST', '/api/films', 'S3b'],
    ['POST', `/api/films/${FILM}/chat`, 'S6'],
    ['POST', `/api/films/${FILM}/undo`, 'S6'],
    ['POST', `/api/films/${FILM}/redo`, 'S6'],
    ['POST', `/api/films/${FILM}/frames`, 'S5b'],
    ['POST', `/api/films/${FILM}/scenes/s1/mode`, 'S7a'],
    ['POST', `/api/films/${FILM}/scenes/s1/approve`, 'S7a'],
    ['GET', '/api/local-mode', 'S9'],
    ['PUT', '/api/local-mode', 'S9'],
  ];
  it.each(rows)('%s %s -> 501 %s', async (method, path, owner) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'not_implemented', owner });
  });
});
