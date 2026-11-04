import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { foldCrew } from './crewReducer';
import { TakesPicker } from './TakesPicker';
import { FIXTURE } from './test-fixture';

it('marks the highest score as the critic\'s pick', () => {
  render(<TakesPicker crew={foldCrew(FIXTURE)} onPick={vi.fn()} />);
  const b = screen.getByText('Take B').closest('figure')!;
  expect(b).toHaveTextContent("critic's pick");
  expect(screen.getAllByText("critic's pick")).toHaveLength(1);
});

it('picks a take by its film id and then says it is in the film', async () => {
  const onPick = vi.fn().mockResolvedValue(undefined);
  render(<TakesPicker crew={foldCrew(FIXTURE)} onPick={onPick} />);
  const c = screen.getByText('Take C').closest('figure')!;
  fireEvent.click(c.querySelector('button')!);
  expect(onPick).toHaveBeenCalledWith('j6', 'film_0123456789' + '03');
  expect(await screen.findByText('in the film')).toBeInTheDocument();
});

it('renders nothing without takes', () => {
  const { container } = render(<TakesPicker crew={foldCrew([])} onPick={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

it('shows a refused pick', async () => {
  render(<TakesPicker crew={foldCrew(FIXTURE)} onPick={vi.fn().mockRejectedValue(new Error('scene is busy'))} />);
  fireEvent.click(screen.getByText('Take A').closest('figure')!.querySelector('button')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('scene is busy');
});
