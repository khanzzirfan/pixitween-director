import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilmEvent } from '@shared/events';
import Chat from '../Chat';

const status = { local: false, reachable: true, modelPresent: true, loaded: false, model: 'muse-glimmer:30b-mlx', host: 'localhost:11434', checkedAt: 'now' };
const turn = { filmId: 'film_3fa9c2d41b7e', at: '2026-10-29T00:00:00Z', seq: 1, type: 'agent.turn', backend: 'glimmer', ms: 24300, calls: 2 } as unknown as FilmEvent;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(status), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

it('the Chat header has the Local-mode switch and says which model made the last edit', async () => {
  render(<Chat film={null} events={[turn]} />);
  expect(await screen.findByRole('switch', { name: 'Local mode (Muse Glimmer)' })).toBeInTheDocument();
  expect(screen.getByText('edited by Muse Glimmer (local) · 24 s')).toBeInTheDocument();
});
