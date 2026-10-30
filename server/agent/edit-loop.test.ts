import { describe, expect, it } from 'vitest';
import type { LlmBackend } from '@shared/ports';
import { addLayer, addScene, newFilmComposition } from '../authoring/api';
import { placeProduct3D } from '../product3d/authoring';
import { makeTestFilm } from '../test-utils/film';
import { allTools } from '../tools/registry';
import { buildEditMessages, EDIT_SYSTEM_PROMPT } from './edit-prompt';
import { assertEditable, FilmBusyError, FilmNotReadyError, MAX_TURNS, runEditWithCtx } from './edit-loop';

async function filmWithText() {
  const t = await makeTestFilm();
  let comp = newFilmComposition({ aspect: '16:9', title: 'Test', palette: ['#111827'] });
  comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'motion', intent: 'hero' });
  comp = addLayer(comp, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  comp = addLayer(comp, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Hello' });
  await t.films.commit(t.filmId, comp, 'director');
  return t;
}

const scripted = (...turns: Array<Array<{ name: string; args: unknown }>>): LlmBackend => {
  let n = 0;
  return {
    id: 'spark',
    async chatWithTools() {
      const calls = turns[n++] ?? [];
      return { toolCalls: calls.map((c, i) => ({ id: `c${n}_${i}`, ...c })), content: calls.length ? '' : 'Done.', ms: 1 };
    },
  };
};

describe('assertEditable', () => {
  const film = (status: string, composition: unknown) => ({ status, composition }) as never;
  it('rejects a film with no composition', () => {
    expect(() => assertEditable(film('ready', undefined), [])).toThrow(FilmNotReadyError);
  });
  it('rejects a film that is building right now, but not a stale one', () => {
    const now = Date.parse('2026-01-01T01:00:00Z');
    const recent = [{ at: '2026-01-01T00:59:00Z' }] as never;
    const stale = [{ at: '2026-01-01T00:00:00Z' }] as never;
    expect(() => assertEditable(film('building', {}), recent, now)).toThrow(FilmBusyError);
    expect(() => assertEditable(film('building', {}), stale, now)).not.toThrow();
    expect(() => assertEditable(film('ready', {}), recent, now)).not.toThrow();
  });
});

describe('runEditWithCtx', () => {
  it('applies tool calls, commits a version and returns to ready', async () => {
    const t = await filmWithText();
    const before = (await t.films.get(t.filmId)).version;
    const out = await runEditWithCtx(
      t.ctx,
      { message: 'make the headline bigger' },
      {
        backend: scripted([{ name: 'scaleLayer', args: { layerId: 's1:headline', factor: 1.5 } }]),
        tools: allTools(),
      },
    );
    expect(out).toMatchObject({ ok: true, applied: 1, failed: 0, turns: 1, versionBefore: before });
    expect(out.versionAfter).toBeGreaterThan(before);
    expect((await t.films.get(t.filmId)).status).toBe('ready');
    expect(t.events.map((e) => e.type)).toEqual(expect.arrayContaining(['agent.turn', 'tool.call', 'film.status']));
  });

  it('feeds a failed call back and recovers on the next turn', async () => {
    const t = await filmWithText();
    const out = await runEditWithCtx(
      t.ctx,
      { message: 'nudge it' },
      {
        backend: scripted(
          [{ name: 'nudgeLayer', args: { layerId: 'nope', dyPct: 5 } }],
          [{ name: 'nudgeLayer', args: { layerId: 's1:headline', dyPct: 5 } }],
        ),
        tools: allTools(),
      },
    );
    expect(out.turns).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.applied).toBe(1);
    expect(out.ok).toBe(true);
  });

  it(`gives up after ${MAX_TURNS} turns of failures and reports it`, async () => {
    const t = await filmWithText();
    const bad = { name: 'nudgeLayer', args: { layerId: 'nope', dyPct: 5 } };
    const out = await runEditWithCtx(t.ctx, { message: 'x' }, { backend: scripted([bad], [bad], [bad], [bad]), tools: allTools() });
    expect(out).toMatchObject({ ok: false, error: `gave up after ${MAX_TURNS} turns` });
    expect((await t.films.get(t.filmId)).status).toBe('ready');
  });

  it('refuses a second edit while one is running and releases the lock afterwards', async () => {
    const t = await filmWithText();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: LlmBackend = {
      id: 'spark',
      async chatWithTools() {
        await gate;
        return { toolCalls: [], content: 'Nothing to do.', ms: 1 };
      },
    };
    const first = runEditWithCtx(t.ctx, { message: 'a' }, { backend: slow, tools: allTools() });
    await expect(runEditWithCtx(t.ctx, { message: 'b' }, { backend: slow, tools: allTools() })).rejects.toBeInstanceOf(FilmBusyError);
    release();
    expect((await first).ok).toBe(false);
    await expect(runEditWithCtx(t.ctx, { message: 'c' }, { backend: scripted([]), tools: allTools() })).resolves.toBeDefined();
  });

  it('records a backend failure without throwing', async () => {
    const t = await filmWithText();
    const broken: LlmBackend = {
      id: 'spark',
      async chatWithTools() {
        throw new Error('upstream 500');
      },
    };
    const out = await runEditWithCtx(t.ctx, { message: 'x' }, { backend: broken, tools: allTools() });
    expect(out).toMatchObject({ ok: false, error: 'upstream 500' });
    await new Promise((r) => setTimeout(r, 50)); // the bus delivers after it has appended to disk
    expect(t.events.some((e) => e.type === 'error' && e.where === 'edit')).toBe(true);
  });
});

describe('3D edits (S13b)', () => {
  const sys = (comp: unknown) => buildEditMessages({ comp: comp as never, message: 'turn it more' })[0]!.content as string;

  async function filmWith3D() {
    const t = await filmWithText();
    const film = await t.films.get(t.filmId);
    const comp = placeProduct3D(film.composition as never, {
      sceneId: 's1',
      box: { x: 760, y: 140, w: 400, h: 800 },
      shape: 'can',
      texture: { id: 'ast_11111111111111111111111111111111', url: '/api/assets/ast_11111111111111111111111111111111', width: 2048, height: 1024, kind: 'label' },
      side: '#1f2937',
      aspect: 2,
    });
    expect((await t.films.commit(t.filmId, comp, 'director')).ok).toBe(true);
    return t;
  }

  it("names turnProduct in the system text of a film with a 3D product, and not in a 2D film's", async () => {
    const flat = await filmWithText();
    const three = await filmWith3D();
    expect(sys((await three.films.get(three.filmId)).composition)).toContain('turnProduct');
    expect(sys((await three.films.get(three.filmId)).composition)).toContain('lightProduct');
    expect(sys((await flat.films.get(flat.filmId)).composition)).not.toContain('turnProduct');
    expect(sys((await flat.films.get(flat.filmId)).composition)).toBe(EDIT_SYSTEM_PROMPT);
  });

  it("a scripted turnProduct with to 30 commits one new version with source 'chat'", async () => {
    process.env.PRODUCT_3D = 'true';
    try {
      const t = await filmWith3D();
      const before = (await t.films.get(t.filmId)).version;
      const out = await runEditWithCtx(t.ctx, { message: 'turn it more' }, { backend: scripted([{ name: 'turnProduct', args: { sceneId: 's1', to: 30 } }]), tools: allTools() });
      expect(out).toMatchObject({ ok: true, applied: 1, failed: 0 });
      const versions = await t.films.versions(t.filmId);
      expect(versions.length).toBe(before + 1);
      expect(versions.at(-1)).toMatchObject({ source: 'chat' });
      const l = (((await t.films.get(t.filmId)).composition as { precomps: Record<string, { layers: Array<Record<string, any>> }> }).precomps.s1!.layers).find((x) => x.id === 's1:product3d')!;
      expect(l.view.rotation.at(-1).v).toEqual([4, 30, 0]);
    } finally {
      delete process.env.PRODUCT_3D;
    }
  });
});
