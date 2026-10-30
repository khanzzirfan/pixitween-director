import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { FilmEvent } from '@shared/events';
import GenerateApproval from './GenerateApproval';
import { GenerateApiError, type GenerateApi } from './useGenerate';

const F = 'film_aaaaaaaaaaaa';
const comp = (modes: Record<string, string>) => ({ meta: { director: { scenes: Object.fromEntries(Object.entries(modes).map(([k, m]) => [k, { mode: m }])) } } }) as unknown as AepCompositionJson;
const ev = (e: Record<string, unknown>) => ({ filmId: F, at: 'x', ...e }) as FilmEvent;
const proposal = (o: Record<string, unknown> = {}) => ({ token: 'tok', sceneId: 's2', attempt: 1, model: 'fast-h3', durationSec: 5.2, withSound: false, estCredits: 25, reason: 'Needs real motion', balance: 120, expiresAt: '2099-01-01T00:00:00Z', ...o });
const mkApi = (p: Record<string, unknown> | undefined = proposal()): GenerateApi => ({
  setMode: vi.fn(async (_f, _s, mode) => (mode === 'generate' ? { mode, proposal: p } : { mode })) as never,
  approve: vi.fn(async () => ({ accepted: true })),
});

async function reviewed(api: GenerateApi) {
  render(<GenerateApproval filmId={F} comp={comp({ s2: 'generate' })} events={[]} api={api} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review and approve' }));
  await screen.findByRole('button', { name: 'Approve' });
}

describe('proposal', () => {
  it('shows cost, balance and both buttons; approve and keep-as-motion call the API', async () => {
    const api = mkApi();
    await reviewed(api);
    expect(screen.getByText(/about 25 credits, usually a few minutes/)).toBeInTheDocument();
    expect(screen.getByText('Balance: 120 credits')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledTimes(1));
    expect(api.approve).toHaveBeenCalledWith(F, 's2', 'tok');
    fireEvent.click(screen.getByRole('button', { name: 'Keep as motion' }));
    await waitFor(() => expect(api.setMode).toHaveBeenCalledWith(F, 's2', 'motion'));
  });
  it('says the balance is unavailable', async () => {
    await reviewed(mkApi(proposal({ balance: undefined })));
    expect(screen.getByText('Balance unavailable')).toBeInTheDocument();
  });
  it('disables Approve once the proposal expired', async () => {
    await reviewed(mkApi(proposal({ expiresAt: '2000-01-01T00:00:00Z' })));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByText('The proposal expired, review again')).toBeInTheDocument();
  });
});

describe('errors', () => {
  it('shows the public URL message and keeps Approve disabled', async () => {
    const api = mkApi();
    (api.approve as ReturnType<typeof vi.fn>).mockRejectedValue(new GenerateApiError(422, { error: 'public_url_invalid', message: 'Got localhost.' }));
    await reviewed(api);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Got localhost.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
  it('turns rate_limited into minutes', async () => {
    const api = mkApi();
    (api.approve as ReturnType<typeof vi.fn>).mockRejectedValue(new GenerateApiError(429, { error: 'rate_limited', retryAfterSec: 120 }));
    await reviewed(api);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/try again in 2 minutes/)).toBeInTheDocument();
  });
});

describe('phases', () => {
  it('shows a placed clip with the visible fraction', () => {
    render(<GenerateApproval filmId={F} comp={comp({ s2: 'generate' })} api={mkApi()} events={[ev({ type: 'generate.done', sceneId: 's2', asset: { id: 'a', url: '/a', mime: 'video/mp4' }, productVisibleFrac: 0.92 })]} />);
    expect(screen.getByText(/Clip placed/)).toBeInTheDocument();
    expect(screen.getByText(/Product visible in 92% of frames/)).toBeInTheDocument();
  });
  it('shows failures and retries', () => {
    render(<GenerateApproval filmId={F} comp={comp({ s2: 'generate' })} api={mkApi()} events={[ev({ type: 'generate.progress', sceneId: 's2', status: 'failed: pro_plan_required' })]} />);
    expect(screen.getByText('pro_plan_required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('shows an empty state without a film', () => {
    render(<GenerateApproval events={[]} api={mkApi()} />);
    expect(screen.getByText(/Open a film/)).toBeInTheDocument();
  });
});

describe('3D (S13b)', () => {
  const comp3d = (three: boolean) =>
    ({
      meta: { director: { scenes: { s1: { mode: 'motion' } } } },
      precomps: { s1: { layers: three ? [{ id: 's1:product3d', kind: 'model3d' }] : [{ id: 's1:product', kind: 'image' }] } },
    }) as unknown as AepCompositionJson;

  it('shows three options with product3d on, and clicking 3D posts { mode: 3d } for that scene', async () => {
    const api = mkApi();
    render(<GenerateApproval filmId={F} comp={comp3d(false)} events={[]} api={api} product3d />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['MOTION', '3D', 'GENERATE']);
    fireEvent.click(screen.getByRole('radio', { name: '3D' }));
    await waitFor(() => expect(api.setMode).toHaveBeenCalledWith(F, 's1', '3d'));
  });

  it('shows the two options it always had with product3d off', () => {
    render(<GenerateApproval filmId={F} comp={comp3d(false)} events={[]} api={mkApi()} product3d={false} />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['MOTION', 'GENERATE']);
  });

  it('selects 3D for a scene that has a 3D product layer and switches back to motion for free', async () => {
    const api = mkApi();
    render(<GenerateApproval filmId={F} comp={comp3d(true)} events={[]} api={api} product3d />);
    expect(screen.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'MOTION' }));
    await waitFor(() => expect(api.setMode).toHaveBeenCalledWith(F, 's1', 'motion'));
  });

  it('shows why a switch to 3D was refused', async () => {
    const api: GenerateApi = { setMode: vi.fn(async () => { throw new GenerateApiError(422, { error: 'cannot_place', message: 'scene s1 has no product cut-out yet' }); }), approve: vi.fn() } as never;
    render(<GenerateApproval filmId={F} comp={comp3d(false)} events={[]} api={api} product3d />);
    fireEvent.click(screen.getByRole('radio', { name: '3D' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no product cut-out');
  });
});
