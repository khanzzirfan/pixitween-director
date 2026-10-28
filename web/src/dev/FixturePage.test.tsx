import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FixturePage } from './FixturePage';

vi.mock('../player/Player', () => ({ default: () => <div data-testid="player-mock" /> }));

it('lists the five s02 fixtures', () => {
  render(<FixturePage />);
  const labels = Array.from(screen.getByLabelText('Fixture').querySelectorAll('option')).map((o) => o.textContent);
  for (const l of ['s02/shape-only', 's02/text', 's02/image', 's02/scene-precomp', 's02/animated']) expect(labels).toContain(l);
});

it('shows both validators ok for every s02 fixture', () => {
  render(<FixturePage />);
  const select = screen.getByLabelText('Fixture');
  for (const l of ['s02/shape-only', 's02/text', 's02/image', 's02/scene-precomp', 's02/animated']) {
    fireEvent.change(select, { target: { value: l } });
    expect(screen.getByTestId('verdicts')).toHaveTextContent('engine: ok');
    expect(screen.getByTestId('verdicts')).toHaveTextContent('light: ok');
  }
});
