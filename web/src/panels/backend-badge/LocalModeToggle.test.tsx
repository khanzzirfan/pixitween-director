import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalModeResponse } from '@shared/api';
import { LocalModeToggle } from './LocalModeToggle';

const ready: LocalModeResponse = { local: false, reachable: true, modelPresent: true, loaded: false, model: 'muse-glimmer:30b-mlx', host: 'localhost:11434', checkedAt: 'now' };
const switchEl = () => screen.getByRole('switch', { name: 'Local mode (Muse Glimmer)' });

afterEach(() => vi.useRealTimers());

describe('LocalModeToggle', () => {
  it('shows ready and switches on through putLocal', async () => {
    const putLocal = vi.fn(async () => ({ ...ready, local: true }));
    render(<LocalModeToggle fetchStatus={async () => ready} putLocal={putLocal} />);
    await screen.findByText('Muse Glimmer 30B on localhost:11434 - ready');
    expect(switchEl()).toBeEnabled();
    await userEvent.click(switchEl());
    expect(putLocal).toHaveBeenCalledWith(true);
    await screen.findByText('Edits stay on this computer. New art still uses the Meta API.');
  });

  it('disables the switch with a reason when Ollama or the model is missing', async () => {
    const { unmount } = render(<LocalModeToggle fetchStatus={async () => ({ ...ready, reachable: false, modelPresent: false })} putLocal={vi.fn()} />);
    await screen.findByText(/ollama serve/);
    expect(switchEl()).toBeDisabled();
    unmount();
    render(<LocalModeToggle fetchStatus={async () => ({ ...ready, modelPresent: false })} putLocal={vi.fn()} />);
    await screen.findByText(/ollama pull muse-glimmer:30b-mlx/);
    expect(switchEl()).toBeDisabled();
  });

  it('shows the server message and stays off when turning on is refused', async () => {
    render(<LocalModeToggle fetchStatus={async () => ready} putLocal={async () => ({ error: 'glimmer_unreachable', message: 'nope' })} />);
    await screen.findByText(/ready/);
    await userEvent.click(switchEl());
    await screen.findByText('nope');
    expect(switchEl()).not.toBeChecked();
  });
});

describe('polling', () => {
  beforeEach(() => vi.useFakeTimers());

  it('checks again every 30 s and stops on unmount', async () => {
    const fetchStatus = vi.fn(async () => ready);
    const { unmount } = render(<LocalModeToggle fetchStatus={fetchStatus} putLocal={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });
});
