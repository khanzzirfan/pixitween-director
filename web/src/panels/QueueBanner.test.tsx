import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueueBanner } from './QueueBanner';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

it('shows a queued film its place and a rough wait', async () => {
  render(<QueueBanner filmId="f1" status="new" fetchImpl={reply({ state: 'queued', position: 2, etaSec: 200 })} />);
  await flush();
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for the crew: #2 in line, about 4 min (estimate)');
});

it('says the crew is starting when the film is running', async () => {
  render(<QueueBanner filmId="f1" status="new" fetchImpl={reply({ state: 'running' })} />);
  await flush();
  expect(screen.getByRole('status')).toHaveTextContent('Starting the crew…');
});

it('renders nothing, and asks nothing, once the film is past new', async () => {
  const f = reply({ state: 'queued', position: 1, etaSec: 100 });
  render(<QueueBanner filmId="f1" status="planning" fetchImpl={f} />);
  await flush();
  expect(screen.queryByRole('status')).toBeNull();
  expect(f).not.toHaveBeenCalled();
});

it('renders nothing for an unknown film', async () => {
  render(<QueueBanner filmId="f1" status="new" fetchImpl={reply({ state: 'unknown' })} />);
  await flush();
  expect(screen.queryByRole('status')).toBeNull();
});

it('polls while new and stops when the status changes', async () => {
  const f = reply({ state: 'queued', position: 1, etaSec: 100 });
  const { rerender } = render(<QueueBanner filmId="f1" status="new" pollMs={5000} fetchImpl={f} />);
  await flush();
  expect(f).toHaveBeenCalledTimes(1);
  await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
  expect(f).toHaveBeenCalledTimes(2);
  rerender(<QueueBanner filmId="f1" status="planning" pollMs={5000} fetchImpl={f} />);
  await act(async () => void (await vi.advanceTimersByTimeAsync(20000)));
  expect(f).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).toBeNull();
});
