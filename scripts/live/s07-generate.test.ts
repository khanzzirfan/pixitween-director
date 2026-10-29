import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lightValidator } from '../../server/engine/validate';
import { buildLiveFilm, describe as describeScript, estimateUsd, missingEnv, renderLiveReport, run, type LiveResult } from './s07-generate';

afterEach(() => vi.unstubAllEnvs());

describe('s07-generate', () => {
  it('states what it spends', () => {
    expect(estimateUsd()).toBe(0.06);
    const d = describeScript();
    expect(d).toContain('ONE real clip');
    expect(d).toContain('25');
    expect(d).toContain('sent to Clippy');
  });

  it('names the missing environment variables', () => {
    expect(missingEnv({})).toEqual(['CLIPPY_MCP_URL', 'CLIPPY_TOKEN', 'META_API_KEY', 'PUBLIC_BASE_URL']);
    expect(missingEnv({ CLIPPY_MCP_URL: 'a', CLIPPY_TOKEN: 'b', META_API_KEY: 'c', PUBLIC_BASE_URL: 'd' })).toEqual([]);
  });

  it('rejects a local PUBLIC_BASE_URL before any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.stubEnv('CLIPPY_MCP_URL', 'https://clippy.example.test/mcp');
    vi.stubEnv('CLIPPY_TOKEN', 't');
    vi.stubEnv('META_API_KEY', 'm');
    vi.stubEnv('PUBLIC_BASE_URL', 'http://localhost:8788');
    await expect(run({ env: {} as never, log: () => undefined })).rejects.toThrow(/PUBLIC_BASE_URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds a valid one-scene generate film, and the committed fixture matches it', () => {
    const film = buildLiveFilm();
    expect(lightValidator.validate(film.composition)).toMatchObject({ ok: true });
    const modes = Object.values((film.composition.meta as { director: { scenes: Record<string, { mode: string }> } }).director.scenes).map((s) => s.mode);
    expect(modes).toEqual(['generate']);
    expect(JSON.parse(readFileSync('fixtures/s07b/film-with-generate-scene.json', 'utf8'))).toEqual(JSON.parse(JSON.stringify(film.composition)));
  });

  it('renders a report without URLs, queries or tokens', () => {
    const r: LiveResult = {
      jobId: 'job_42', outcome: 'done', secondsToDone: 87.3, statuses: [{ status: 'rendering', atSec: 2.1 }], clip: { bytes: 1234567, width: 1280, height: 720 },
      productVisibleFrac: 0.9, compositionValid: true, creditsCharged: 25,
    };
    const text = renderLiveReport(r);
    expect(text).toContain('job_42');
    expect(text).toContain('87.3');
    expect(text).toContain('0.9');
    expect(text).not.toMatch(/https?:\S*\?/);
    expect(text).not.toContain('Bearer');
  });
});
