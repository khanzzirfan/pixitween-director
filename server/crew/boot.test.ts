import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Job } from '@shared/crew';
import { newFilmComposition } from '../authoring/api';
import { makeTestDeps } from '../test-utils/deps';
import { recoverCrewFilms, registerCrew } from './boot';
import { createCrewPersist } from './persist';

const brief = { aspect: '16:9' as const, brief: { text: 'x', productAssetId: 'ast_' + '0'.repeat(32) }, assets: [] };
const job = (id: string, status: Job['status']): Job => ({ id, kind: 'build-scene', sceneId: 's1', filmId: 'film_aaaaaaaaaaaa', brief: 'b', reason: 'r', origin: 'auto', status, createdAt: '2026-10-30T00:00:00Z', costUsd: 0 });
const settle = () => new Promise<void>((r) => setTimeout(r, 30));

async function crewFilm(deps: Awaited<ReturnType<typeof makeTestDeps>>, o: { jobs: Job[]; composition?: boolean; status?: 'building' | 'ready' | 'planning' }) {
  const film = await deps.films.create({ ...brief, crew: true });
  if (o.composition) await deps.films.commit(film.id, newFilmComposition({ aspect: '16:9', title: 't', palette: ['#111111'] }), 'director');
  await deps.films.update(film.id, { status: o.status ?? 'building' });
  await createCrewPersist(deps.dataDir!, film.id).saveBoard(o.jobs);
  return film.id;
}

describe('recoverCrewFilms', () => {
  it('turns a running job into failed restart and a queued one into cancelled', async () => {
    const deps = await makeTestDeps();
    const id = await crewFilm(deps, { jobs: [job('j1', 'running'), job('j2', 'queued'), job('j3', 'done')], composition: true });
    expect(await recoverCrewFilms(deps)).toEqual([id]);
    const board = await createCrewPersist(deps.dataDir!, id).loadBoard();
    expect(board.map((j) => [j.id, j.status, j.error])).toEqual([['j1', 'failed', 'restart'], ['j2', 'cancelled', undefined], ['j3', 'done', undefined]]);
    await settle();
    expect(deps.events.filter((e) => e.type === 'error').map((e) => (e as { where: string }).where)).toContain('crew.restart');
  });

  it('awaiting-frames fails with restart too', async () => {
    const deps = await makeTestDeps();
    const id = await crewFilm(deps, { jobs: [job('j1', 'awaiting-frames')] });
    await recoverCrewFilms(deps);
    expect((await createCrewPersist(deps.dataDir!, id).loadBoard())[0]).toMatchObject({ status: 'failed', error: 'restart' });
  });

  it('a film with a composition ends ready, one without ends failed', async () => {
    const deps = await makeTestDeps();
    const withComp = await crewFilm(deps, { jobs: [job('j1', 'running')], composition: true });
    const without = await crewFilm(deps, { jobs: [job('j1', 'running')] });
    await recoverCrewFilms(deps);
    expect((await deps.films.get(withComp)).status).toBe('ready');
    expect((await deps.films.get(without)).status).toBe('failed');
  });

  it('a film stuck in planning with no board is closed out too', async () => {
    const deps = await makeTestDeps();
    const id = await crewFilm(deps, { jobs: [], status: 'planning' });
    expect(await recoverCrewFilms(deps)).toEqual([id]);
    expect((await deps.films.get(id)).status).toBe('failed');
  });

  it('leaves a quiet ready film, a non-crew film and a finished board alone', async () => {
    const deps = await makeTestDeps();
    await crewFilm(deps, { jobs: [job('j1', 'done')], composition: true, status: 'ready' });
    const plain = await deps.films.create(brief);
    await deps.films.update(plain.id, { status: 'building' });
    expect(await recoverCrewFilms(deps)).toEqual([]);
    expect((await deps.films.get(plain.id)).status).toBe('building');
  });

  it('is what the boot hook runs, after mounting the routes', async () => {
    const deps = await makeTestDeps();
    const id = await crewFilm(deps, { jobs: [job('j1', 'running')], composition: true });
    const app = new Hono();
    await registerCrew({ app, deps });
    expect((await deps.films.get(id)).status).toBe('ready');
    expect((await app.request(`/api/films/${id}/crew`)).status).toBe(200);
  });
});
