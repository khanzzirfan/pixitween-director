import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Job } from '@shared/crew';
import { JobChip } from './JobChip';

const job = (o: Partial<Job>): Job => ({ id: 'j1', kind: 'build-scene', sceneId: 's1', filmId: 'film_0123456789ab', brief: 'b', reason: 'r', origin: 'showrunner', status: 'running', createdAt: '2026-10-30T14:00:00.000Z', costUsd: 0, ...o });

it('shows a superseded job struck through with what replaced it', () => {
  const { container } = render(<JobChip job={job({ status: 'superseded', supersededBy: 'j9' })} onCancel={vi.fn()} />);
  expect(container.firstChild).toHaveClass('is-superseded');
  expect(screen.getByText('replaced by j9')).toBeInTheDocument();
});

it('cancels a running job with its id, and offers no cancel on a done one', () => {
  const onCancel = vi.fn();
  const { rerender } = render(<JobChip job={job({})} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel j1' }));
  expect(onCancel).toHaveBeenCalledWith('j1');
  rerender(<JobChip job={job({ status: 'done', ms: 2400 })} onCancel={onCancel} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('2.4 s')).toBeInTheDocument();
});

it('labels a job waiting for frames', () => {
  render(<JobChip job={job({ status: 'awaiting-frames' })} />);
  expect(screen.getByText('waiting for frames')).toBeInTheDocument();
});
