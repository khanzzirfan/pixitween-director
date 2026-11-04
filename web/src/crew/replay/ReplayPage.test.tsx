import { act, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../App';
import * as client from '../../api/client';
import { FIXTURE } from '../test-fixture';

vi.mock('../../player/Player', () => ({ default: forwardRef(() => <div data-testid="player-stub" />) }));

const ID = 'film_3fa9c2d41b7e';
const film = { id: ID, status: 'ready', aspect: '16:9', crew: true, version: 3, assets: [], brief: { text: 'a mug', productAssetId: 'ast_x' }, composition: { id: 'last' } } as never;
const versions = [
  { version: 1, composition: { id: 'v1' }, source: 'director', at: FIXTURE[0]!.at },
  { version: 2, composition: { id: 'v2' }, source: 'director', at: FIXTURE[FIXTURE.length - 1]!.at },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(client.api, 'getFilm').mockResolvedValue(film);
  vi.spyOn(client.api, 'getVersions').mockResolvedValue(versions as never);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(FIXTURE), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const es = vi.fn();
  vi.stubGlobal('EventSource', es);
  window.history.replaceState({}, '', `/?film=${ID}&replay=1`);
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

it('shows a read-only studio: no chat input, no push-to-talk, no Cancel and no Pick buttons', async () => {
  render(<App />);
  await settle();
  expect(screen.getByTestId('crew-studio')).toBeInTheDocument();
  await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
  expect(screen.queryByLabelText('Message')).toBeNull();
  expect(screen.queryByRole('button', { name: /talk|record/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Pick' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  expect(screen.getByRole('group', { name: 'Replay' })).toBeInTheDocument();
});

it('reads the log once, never opens the event stream and never calls a mutating route', async () => {
  render(<App />);
  await settle();
  await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
  expect(calls.filter(([u]) => u === `/api/films/${ID}/log`)).toHaveLength(1);
  expect(calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  expect(EventSource).not.toHaveBeenCalled();
});

it('plays to the end at 4x with the lanes changing, then offers to watch again', async () => {
  render(<App />);
  await settle();
  fireEvent.click(screen.getByTestId('rail-crew'));
  expect(screen.getByRole('radio', { name: '4×' })).toHaveAttribute('aria-checked', 'true');
  await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
  const early = screen.getByRole('region', { name: 'Crew' }).textContent;
  await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
  expect(screen.getByRole('region', { name: 'Crew' }).textContent).not.toBe(early);
  expect(screen.getByRole('button', { name: 'Watch again' })).toBeInTheDocument();
});

it('scrubbing and the speed buttons work', async () => {
  render(<App />);
  await settle();
  await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
  fireEvent.change(screen.getByLabelText('Replay position'), { target: { value: '500' } });
  expect(screen.getByRole('button', { name: 'Play replay' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: '8×' }));
  expect(screen.getByRole('radio', { name: '8×' })).toHaveAttribute('aria-checked', 'true');
});

it('says so when the film has no log', async () => {
  fetchMock.mockImplementation(async () => new Response('{"error":"not_found"}', { status: 404 }));
  render(<App />);
  await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('no replay');
});
