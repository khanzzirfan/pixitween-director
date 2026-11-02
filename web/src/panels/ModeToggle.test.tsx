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

it('offers 3D as a third option when product3d is on, and clicking it asks for 3d', () => {
  const onChange = vi.fn();
  render(<ModeToggle sceneId="s1" mode="motion" product3d onChange={onChange} />);
  expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['MOTION', '3D', 'GENERATE']);
  fireEvent.click(screen.getByRole('radio', { name: '3D' }));
  expect(onChange).toHaveBeenCalledWith('3d');
});

it('shows only the two options when product3d is off', () => {
  render(<ModeToggle sceneId="s1" mode="motion" onChange={() => undefined} />);
  expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['MOTION', 'GENERATE']);
  expect(screen.queryByRole('radio', { name: '3D' })).toBeNull();
});

it('marks 3D as the selection and says what it is', () => {
  render(<ModeToggle sceneId="s1" mode="3d" product3d onChange={() => undefined} />);
  expect(screen.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText(/real product turns in studio light/i)).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'MOTION' })).toHaveAttribute('aria-checked', 'false');
});
