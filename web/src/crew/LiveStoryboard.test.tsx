import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FilmEvent } from '@shared/events';
import { foldCrew, crewReducer } from './crewReducer';
import { LiveStoryboard } from './LiveStoryboard';
import { FIXTURE, MARKS, upTo } from './test-fixture';

afterEach(() => vi.restoreAllMocks());
const NOW = Date.parse('2026-10-30T14:00:17.000Z'); // a second after rev 2
const ids = () => [...document.querySelectorAll('[data-scene]')].map((e) => e.getAttribute('data-scene'));
const setup = (events = FIXTURE, onOps = vi.fn().mockResolvedValue(undefined)) => {
  render(<LiveStoryboard crew={foldCrew(events)} now={NOW} onOps={onOps} />);
  return onOps;
};

it('lists cards in order and glows the scene the latest revision added', () => {
  setup();
  expect(ids()).toEqual(['s1', 's2', 's5', 's3', 's4']);
  expect(document.querySelector('[data-scene="s5"]')).toHaveClass('is-new');
  expect(document.querySelector('[data-scene="s1"]')).not.toHaveClass('is-new');
});

it('stops the glow after 2 s', () => {
  render(<LiveStoryboard crew={foldCrew(FIXTURE)} now={NOW + 2500} onOps={vi.fn()} />);
  expect(document.querySelector('[data-scene="s5"]')).not.toHaveClass('is-new');
});

it('labels a scene whose latest writing job runs as building', () => {
  setup(upTo(MARKS.fourBuilds));
  expect(within(document.querySelector('[data-scene="s1"]') as HTMLElement).getByTestId('ring')).toHaveTextContent('building');
});

it('sends one update op for a camera change, and nothing for an unchanged blur', () => {
  const onOps = setup();
  fireEvent.change(screen.getByLabelText('Camera of s2'), { target: { value: 'pan' } }); // s2 is already pan: pick another
  fireEvent.change(screen.getByLabelText('Camera of s2'), { target: { value: 'orbit' } });
  expect(onOps).toHaveBeenLastCalledWith([{ op: 'update', sceneId: 's2', patch: { camera: 'orbit' } }]);
  onOps.mockClear();
  const intent = screen.getByLabelText('Intent of s1');
  fireEvent.focus(intent);
  fireEvent.blur(intent);
  expect(onOps).not.toHaveBeenCalled();
  fireEvent.change(intent, { target: { value: 'A new hero shot' } });
  fireEvent.blur(intent);
  expect(onOps).toHaveBeenCalledWith([{ op: 'update', sceneId: 's1', patch: { intent: 'A new hero shot' } }]);
});

it('adds a scene after s2 from the plus slot', () => {
  const onOps = setup();
  fireEvent.click(screen.getAllByRole('button', { name: 'Add a scene here' })[2]!); // slots: first, after s1, after s2
  fireEvent.change(screen.getByLabelText('New scene intent'), { target: { value: 'sunset on the beach' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  const op = onOps.mock.calls[0]![0][0];
  expect(op).toMatchObject({ op: 'add', after: 's2', scene: { intent: 'sunset on the beach' } });
});

it('moves a scene up past the one above it', () => {
  const onOps = setup(); // order s1 s2 s5 s3 s4: s3 sits at index 3, two places up is s2
  fireEvent.click(screen.getByRole('button', { name: 'Move s3 up' }));
  expect(onOps).toHaveBeenCalledWith([{ op: 'move', sceneId: 's3', after: 's2' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Move s2 up' }));
  expect(onOps).toHaveBeenLastCalledWith([{ op: 'move', sceneId: 's2', after: null }]);
});

it('removes after confirm, and disables remove at 2 scenes', () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const onOps = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Remove s4' }));
  expect(onOps).toHaveBeenCalledWith([{ op: 'remove', sceneId: 's4' }]);
  document.body.innerHTML = '';
  const two = crewReducer(foldCrew(upTo(4)), { ...FIXTURE[3]!, storyboard: { ...(FIXTURE[3] as Extract<FilmEvent, { type: 'storyboard.revised' }>).storyboard, scenes: (FIXTURE[3] as Extract<FilmEvent, { type: 'storyboard.revised' }>).storyboard.scenes.slice(0, 2) } } as FilmEvent);
  render(<LiveStoryboard crew={two} now={NOW} onOps={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Remove s1' })).toBeDisabled();
});

it('shows why an edit was refused', async () => {
  setup(FIXTURE, vi.fn().mockRejectedValue(new Error('scene durations sum to 31s')));
  fireEvent.click(screen.getByRole('button', { name: 'Move s4 up' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('31s');
});

it('shows a hint before any storyboard exists', () => {
  render(<LiveStoryboard crew={foldCrew([])} onOps={vi.fn()} />);
  expect(screen.getByText(/sketching the plan/)).toBeInTheDocument();
});
