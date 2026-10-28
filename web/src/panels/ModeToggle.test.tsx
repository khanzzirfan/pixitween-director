import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ModeToggle from './ModeToggle';

const generate = () => screen.getByRole('radio', { name: 'GENERATE' });

it('switches modes once and ignores the selected option', () => {
  const onChange = vi.fn();
  render(<ModeToggle sceneId="s1" mode="motion" onChange={onChange} />);
  fireEvent.click(screen.getByRole('radio', { name: 'MOTION' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(generate());
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('generate');
  expect(screen.getByText('Real video costs about 25 credits and needs your approval.')).toBeInTheDocument();
});
it('disables GENERATE with a reason', () => {
  render(<ModeToggle sceneId="s1" mode="motion" disabledReason="A film can have at most 2 generated scenes" onChange={() => undefined} />);
  expect(generate()).toBeDisabled();
  expect(screen.getByText('A film can have at most 2 generated scenes')).toBeVisible();
});
it('disables both options when busy and marks the selection', () => {
  render(<ModeToggle sceneId="s1" mode="generate" busy onChange={() => undefined} />);
  expect(generate()).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'MOTION' })).toBeDisabled();
  expect(generate()).toHaveAttribute('aria-checked', 'true');
});
