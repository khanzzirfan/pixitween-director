import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AiVideoJob, AiVideoQuote, AiVideoResolution } from '@shared/api';
import { AiVideoError } from '../export/aiVideo';
import AiMovieCard, { type AiMovieDeps } from './AiMovieCard';

const quote = (r: AiVideoResolution, o: Partial<AiVideoQuote> = {}): AiVideoQuote => ({
  resolution: r, durationSec: 6, filmSec: 6, costUsd: r === '480P' ? 0.3 : 0.48, frames: 2, skippedScenes: [], keyReady: true, ...o,
});
const job = (o: Partial<AiVideoJob> = {}): AiVideoJob => ({ id: 'vid_1', filmId: 'film_aaaaaaaaaaaa', status: 'queued', resolution: '480P', durationSec: 6, costUsd: 0.3, ...o });

const deps = (o: AiMovieDeps & { keyReady?: boolean; skipped?: string[] } = {}): AiMovieDeps => ({
  fetchQuote: vi.fn(async (_id: string, r: AiVideoResolution) => quote(r, { keyReady: o.keyReady ?? true, skippedScenes: o.skipped ?? [] })),
  now: () => new Date('2026-11-04T12:00:00Z'),
  ...o,
});
const card = (d: AiMovieDeps, extra: { hasContent?: boolean; filmId?: string | undefined } = {}) =>
  render(<AiMovieCard filmId={'filmId' in extra ? extra.filmId : 'film_aaaaaaaaaaaa'} title="Sun Stripe" hasContent={extra.hasContent ?? true} deps={d} />);

describe('before anything is spent', () => {
  it('names the cost of each cut and puts the chosen one on the button', async () => {
    card(deps());
    const draft = await screen.findByRole('radio', { name: /Draft/ });
    expect(draft).toHaveAttribute('aria-checked', 'true');
    expect(draft).toHaveTextContent('$0.30');
    expect(screen.getByRole('radio', { name: /Standard/ })).toHaveTextContent('$0.48');
    expect(screen.getByRole('button', { name: /Make AI movie · \$0\.30/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: /Standard/ }));
    expect(screen.getByRole('button', { name: /Make AI movie · \$0\.48/ })).toBeVisible();
    expect(screen.getByText('6 s clip')).toBeVisible();
    expect(screen.getByText('2 reference frames')).toBeVisible();
  });

  it('asks for a Fal key, and starts nothing, when none can pay', async () => {
    const start = vi.fn();
    const open = vi.fn();
    card(deps({ keyReady: false, start, openSettings: open }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add your Fal key' }));
    expect(open).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Make AI movie/ })).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('says which scenes it leaves out and when a film is cut to fit', async () => {
    const d = deps({ skipped: ['b1'] });
    d.fetchQuote = vi.fn(async (_id: string, r: AiVideoResolution) => quote(r, { durationSec: 15, filmSec: 24, skippedScenes: ['b1'] }));
    card(d);
    expect(await screen.findByText(/Left out, with no picture to film from: b1/)).toBeVisible();
    expect(screen.getByText(/15 s clip \(your 24 s film, cut to fit\)/)).toBeVisible();
  });

  it('shows nothing to make for an empty film and never asks for a quote', () => {
    const d = deps();
    card(d, { hasContent: false });
    expect(screen.getByText('Nothing to make a movie from yet.')).toBeVisible();
    expect(d.fetchQuote).not.toHaveBeenCalled();
  });

  it('shows why a quote is unavailable', async () => {
    const d = deps();
    d.fetchQuote = vi.fn(async () => { throw new AiVideoError('This film has no pictures to make an AI movie from yet.', 'no_frames'); });
    card(d);
    expect(await screen.findByText('This film has no pictures to make an AI movie from yet.')).toBeVisible();
  });

  it('refreshes the quote when a key is saved in Settings', async () => {
    let keyReady = false;
    card({ fetchQuote: vi.fn(async (_id: string, r: AiVideoResolution) => quote(r, { keyReady })) });
    await screen.findByRole('button', { name: 'Add your Fal key' });
    keyReady = true;
    act(() => void window.dispatchEvent(new Event('director-access')));
    expect(await screen.findByRole('button', { name: /Make AI movie/ })).toBeVisible();
  });
});

describe('making the movie', () => {
  it('starts the chosen cut, shows the queue and the run, then the finished clip with a download', async () => {
    const start = vi.fn(async () => job());
    const poll = vi.fn(async (_id: string, o: { onView(v: AiVideoJob): void }) => {
      o.onView(job({ status: 'queued', queuePosition: 2 }));
      o.onView(job({ status: 'running' }));
      return job({ status: 'succeeded', videoUrl: '/api/ai-videos/vid_1/download' });
    });
    card(deps({ start, poll: poll as never }));
    fireEvent.click(await screen.findByRole('button', { name: /Make AI movie/ }));
    expect(start).toHaveBeenCalledWith('film_aaaaaaaaaaaa', '480P');

    const video = await screen.findByLabelText('Your AI movie');
    expect(video).toHaveAttribute('src', '/api/ai-videos/vid_1/download');
    const link = screen.getByRole('link', { name: 'Download MP4' });
    expect(link).toHaveAttribute('href', '/api/ai-videos/vid_1/download');
    expect(link.getAttribute('download')).toMatch(/\.mp4$/);
    expect(screen.getByText(/\$0\.30 billed by Fal/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Make another' }));
    expect(await screen.findByRole('button', { name: /Make AI movie/ })).toBeVisible();
  });

  it('shows the wait with the queue position, the clock and the cost, and tells the truth about stopping', async () => {
    let release: (j: AiVideoJob) => void = () => undefined;
    const poll = vi.fn((_id: string, o: { onView(v: AiVideoJob): void }) => new Promise<AiVideoJob>((resolve) => { o.onView(job({ status: 'queued', queuePosition: 4 })); release = resolve; }));
    card(deps({ start: vi.fn(async () => job()), poll: poll as never }));
    fireEvent.click(await screen.findByRole('button', { name: /Make AI movie/ }));
    expect(await screen.findByText("In Fal's queue · position 4")).toBeVisible();
    expect(screen.getByText(/0:0\d · 6 s clip · \$0\.30/)).toBeVisible();
    expect(screen.getByText(/the run continues on Fal and is still billed/)).toBeVisible();
    await act(async () => release(job({ status: 'failed', error: 'Fal could not make the video.' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fal could not make the video.');
  });

  it('stopping the wait stops watching and returns to the options', async () => {
    const signals: AbortSignal[] = [];
    const poll = vi.fn((_id: string, o: { signal?: AbortSignal; onView(v: AiVideoJob): void }) => new Promise<AiVideoJob>((_r, reject) => {
      signals.push(o.signal!);
      o.onView(job({ status: 'running' }));
      o.signal!.addEventListener('abort', () => reject(new AiVideoError('Stopped waiting.', 'aborted')));
    }));
    card(deps({ start: vi.fn(async () => job()), poll: poll as never }));
    fireEvent.click(await screen.findByRole('button', { name: /Make AI movie/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop waiting' }));
    expect(signals[0]!.aborted).toBe(true);
    expect(await screen.findByRole('button', { name: /Make AI movie/ })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a refusal from the start, such as an empty Fal balance, and lets the owner try again', async () => {
    const start = vi.fn(async () => { throw new AiVideoError('Exhausted balance. Top up at fal.ai/dashboard/billing.', 'http_error'); });
    card(deps({ start }));
    fireEvent.click(await screen.findByRole('button', { name: /Make AI movie/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Exhausted balance');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Make AI movie/ })).toBeVisible());
  });
});
