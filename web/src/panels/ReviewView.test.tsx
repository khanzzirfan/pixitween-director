import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewView } from './ReviewView';
import { cleanReviewEvents, reviewFixtureEvents } from './review-fixture';

const base = { film: null, state: 'idle' as const, geometry: null, rerun: () => undefined };

describe('ReviewView', () => {
  it('shows a Rule and a Spark finding and one fix with both frames for scene s1', () => {
    const { container } = render(<ReviewView {...base} events={reviewFixtureEvents()} />);
    const scene = container.querySelector('[data-testid="review-scene-s1"]') as HTMLElement;
    expect(within(scene).getAllByTestId('finding')).toHaveLength(2);
    expect(within(scene).getByText('Rule')).toBeTruthy();
    expect(within(scene).getByText('Spark')).toBeTruthy();
    const fixes = within(scene).getAllByTestId('fix');
    expect(fixes).toHaveLength(1);
    const images = fixes[0]!.querySelectorAll('img');
    expect(images).toHaveLength(2);
    expect(images[0]!.getAttribute('src')!.endsWith('ast_before')).toBe(true);
    expect(images[1]!.getAttribute('src')!.endsWith('ast_after')).toBe(true);
  });

  it('shows the spinner while reviewing and the no-issues line after a clean review', () => {
    const { rerender } = render(<ReviewView {...base} events={reviewFixtureEvents({ status: 'reviewing' })} />);
    expect(screen.getByTestId('review-spinner')).toBeTruthy();
    rerender(<ReviewView {...base} events={cleanReviewEvents()} />);
    expect(screen.queryByTestId('review-spinner')).toBeNull();
    expect(screen.getByText('No issues found')).toBeTruthy();
  });

  it('shows the geometry badge only above the threshold', () => {
    const { rerender } = render(<ReviewView {...base} events={reviewFixtureEvents()} geometry={{ maxRelError: 0.05, layers: 1 }} />);
    expect(screen.getByTestId('geometry-badge').textContent).toBe('Geometry model error 5%');
    rerender(<ReviewView {...base} events={reviewFixtureEvents()} geometry={{ maxRelError: 0.02, layers: 1 }} />);
    expect(screen.queryByTestId('geometry-badge')).toBeNull();
  });

  it('renders evidence as text and re-runs once when clicked', () => {
    const rerun = vi.fn();
    const events = reviewFixtureEvents().map((e) =>
      e.type === 'review.finding' && e.kind === 'low-contrast' ? { ...e, evidence: '<b>x</b>' } : e,
    );
    const { container } = render(<ReviewView {...base} events={events} rerun={rerun} />);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>x</b>')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Re-run review' }));
    expect(rerun).toHaveBeenCalledTimes(1);
  });
});
