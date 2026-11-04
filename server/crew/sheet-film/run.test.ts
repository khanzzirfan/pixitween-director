import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmBackend } from '@shared/ports';
import { makeTestDeps } from '../../test-utils/deps';
import { createCrew } from '../run-crew';
import { makeSheetFilm } from './index';

vi.mock('./index', () => ({ makeSheetFilm: vi.fn() }));
vi.mock('../cinematic-cut', async (orig) => ({ ...(await orig<Record<string, unknown>>()), startCinematic: vi.fn() }));

const saved = { ...process.env };
beforeEach(() => {
  process.env.CREW_ENABLED = 'true';
  process.env.CREW_INBOX_DEBOUNCE_MS = '0';
  process.env.CINEMATIC_CUT = '1';
  delete process.env.FILM_PATH;
  vi.mocked(makeSheetFilm).mockReset();
});
afterEach(() => {
  process.env = { ...saved };
});

const statuses = (events: Array<{ type: string }>) => events.filter((e) => e.type === 'film.status').map((e) => (e as unknown as { status: string }).status);
const backendOf = () => {
  const chatWithTools = vi.fn(async () => ({ toolCalls: [], ms: 1 }));
  return { backend: { id: 'wonder', chatWithTools } as LlmBackend, chatWithTools };
};

describe('a new film takes the sheet film path', () => {
  it('ends ready with no showrunner call', async () => {
    const deps = await makeTestDeps();
    vi.mocked(makeSheetFilm).mockResolvedValue({ ok: true, seconds: { parts: 52, sheets: 21 } });
    const { backend, chatWithTools } = backendOf();
    await createCrew(deps, { backend, idleEndMs: 40 }).runCrew(deps.filmId);
    expect(statuses(deps.events)).toEqual(['planning', 'building', 'ready']);
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(deps.events.find((e) => e.type === 'showrunner.say' && /parts 52 s, sheets 21 s/.test(e.text))).toBeDefined();
  });

  it('never says it is out of time, even past the deadline', async () => {
    process.env.CREW_FILM_DEADLINE_MS = '1000';
    const deps = await makeTestDeps();
    vi.mocked(makeSheetFilm).mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true, seconds: {} }), 1300)));
    const { backend } = backendOf();
    await createCrew(deps, { backend, idleEndMs: 40 }).runCrew(deps.filmId);
    expect(deps.events.some((e) => e.type === 'showrunner.say' && /Out of time/.test(e.text))).toBe(false);
    expect((await deps.films.get(deps.filmId)).status).toBe('ready');
  });

  it('ends failed with an error event naming the reason', async () => {
    const deps = await makeTestDeps();
    vi.mocked(makeSheetFilm).mockResolvedValue({ ok: false, reason: 'the product could not be cut out' });
    const { backend, chatWithTools } = backendOf();
    await createCrew(deps, { backend, idleEndMs: 40 }).runCrew(deps.filmId);
    expect((await deps.films.get(deps.filmId)).status).toBe('failed');
    expect(deps.events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringContaining('could not be cut out') });
    expect(chatWithTools).not.toHaveBeenCalled();
  });

  it('FILM_PATH=crew runs the showrunner as before', async () => {
    process.env.FILM_PATH = 'crew';
    const deps = await makeTestDeps();
    const { backend, chatWithTools } = backendOf();
    await createCrew(deps, { backend, idleEndMs: 40 }).runCrew(deps.filmId);
    expect(chatWithTools).toHaveBeenCalled();
    expect(makeSheetFilm).not.toHaveBeenCalled();
  });
});
