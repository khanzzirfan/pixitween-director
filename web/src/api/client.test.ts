import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiRequestError, api } from './client';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('director.passcode', 'secret');
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const headersOf = (call: number) => (fetchMock.mock.calls[call]![1] as RequestInit).headers as Record<string, string>;

it('sends the passcode on POST but never on GET', async () => {
  await api.listFilms();
  await api.undo('film_aaaaaaaaaaaa');
  expect(headersOf(0)['x-director-passcode']).toBeUndefined();
  expect(headersOf(1)['x-director-passcode']).toBe('secret');
});

it('sends JSON bodies for chat', async () => {
  await api.chat('film_aaaaaaaaaaaa', { message: 'hi' });
  expect(headersOf(0)['Content-Type']).toBe('application/json');
  expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBe('{"message":"hi"}');
});

it('throws ApiRequestError on a non-2xx response', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
  const err = await api.getFilm('film_000000000000').catch((e) => e);
  expect(err).toBeInstanceOf(ApiRequestError);
  expect(err.status).toBe(404);
  expect(err.body).toEqual({ error: 'not_found' });
});
