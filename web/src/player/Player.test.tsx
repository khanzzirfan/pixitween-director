import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { clampSeek, formatTime } from './format';
import Player from './Player';

vi.mock('../motion/MotionStage', () => ({ MotionStage: () => <div data-testid="motion-stage" /> }));

describe('format', () => {
  it('formats time', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.25)).toBe('1:05.3');
    expect(formatTime(Number.NaN)).toBe('0:00.0');
  });
  it('clamps seeks', () => {
    expect(clampSeek(Number.NaN, 10)).toBe(0);
    expect(clampSeek(12, 10)).toBe(10);
    expect(clampSeek(-1, 10)).toBe(0);
    expect(clampSeek(3, 10)).toBe(3);
  });
});

describe('Player', () => {
  it('shows an empty state without a composition', () => {
    render(<Player composition={null} />);
    expect(screen.getByTestId('player-empty')).toHaveTextContent('No film yet');
  });
});
