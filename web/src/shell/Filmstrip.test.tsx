import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Filmstrip, sceneStarts } from './Filmstrip';

const scene = (id: string, durationSec: number, mode: 'motion' | 'generate' = 'motion') => ({ id, durationSec, intent: `intent ${id}`, mode }) as never;

it('renders one chip per scene in order and reports the one clicked', () => {
  const onSelect = vi.fn();
  render(<Filmstrip scenes={[scene('s1', 4), scene('s2', 4), scene('s3', 3), scene('s4', 5)]} onSelect={onSelect} />);
  const chips = [...document.querySelectorAll('[data-scene-chip]')].map((c) => c.getAttribute('data-scene-chip'));
  expect(chips).toEqual(['s1', 's2', 's3', 's4']);
  fireEvent.click(screen.getByTitle('intent s2'));
  expect(onSelect).toHaveBeenCalledWith('s2');
  expect(screen.getByText('16s')).toBeInTheDocument();
});

it('shows the ring of a scene and computes scene start times', () => {
  render(<Filmstrip scenes={[scene('s1', 4), scene('s2', 3)]} ringOf={(id) => (id === 's2' ? 'building' : 'done')} onSelect={() => {}} />);
  expect(document.querySelector('[data-scene-chip="s2"]')).toHaveClass('ring-building');
  expect(sceneStarts([{ durationSec: 4 }, { durationSec: 3 }, { durationSec: 5 }])).toEqual([0, 4, 7]);
});

it('renders nothing without scenes', () => {
  const { container } = render(<Filmstrip scenes={[]} onSelect={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
