import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BudgetMeter } from './BudgetMeter';

it('shows spent and cap to two decimals', () => {
  render(<BudgetMeter budget={{ spentUsd: 0.413, capUsd: 1.5, level: 'ok' }} credits={25} />);
  expect(screen.getByText('$0.41 of $1.50')).toBeInTheDocument();
  expect(screen.getByText('25 credits')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '28');
});

it('goes amber at warn and red at stop', () => {
  const { rerender } = render(<BudgetMeter budget={{ spentUsd: 1.2, capUsd: 1.5, level: 'warn' }} />);
  expect(screen.getByRole('group', { name: 'Budget' })).toHaveClass('is-warn');
  rerender(<BudgetMeter budget={{ spentUsd: 1.5, capUsd: 1.5, level: 'stop' }} />);
  expect(screen.getByRole('group', { name: 'Budget' })).toHaveClass('is-stop');
});

it('says so before the first budget event', () => {
  render(<BudgetMeter budget={undefined} />);
  expect(screen.getByText(/starts with the first turn/)).toBeInTheDocument();
});
