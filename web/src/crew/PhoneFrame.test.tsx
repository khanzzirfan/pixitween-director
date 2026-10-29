import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PhoneFrame, PhoneView } from './PhoneFrame';
import { ChatThread } from './ChatThread';
import { foldCrew, crewReducer } from './crewReducer';
import { FIXTURE } from './test-fixture';
import type { FilmEvent } from '@shared/events';

const media = (width: number) =>
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width: (\d+)px/.exec(q)?.[1];
    const max = /max-width: (\d+)px/.exec(q)?.[1];
    return { matches: (min ? width >= +min : true) && (max ? width <= +max : true) && !q.includes('reduce'), addEventListener() {}, removeEventListener() {} };
  });
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('wraps the thread in a group named Phone view at 1280 px, on by default', () => {
  media(1280);
  render(<PhoneView><p>thread</p></PhoneView>);
  const g = screen.getByRole('group', { name: 'Phone view' });
  expect(g).toHaveTextContent('thread');
  expect(screen.getByRole('switch', { name: 'Phone view' })).toHaveAttribute('aria-checked', 'true');
});

it('draws no frame at 600 px', () => {
  media(600);
  render(<PhoneView><p>thread</p></PhoneView>);
  expect(screen.queryByRole('group', { name: 'Phone view' })).toBeNull();
  expect(screen.getByText('thread')).toBeInTheDocument();
});

it('remembers the toggle, and works when storage throws', () => {
  media(1280);
  const { unmount } = render(<PhoneView><p>thread</p></PhoneView>);
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.queryByRole('group', { name: 'Phone view' })).toBeNull();
  unmount();
  render(<PhoneView><p>thread</p></PhoneView>);
  expect(screen.queryByRole('group', { name: 'Phone view' })).toBeNull();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  document.body.innerHTML = '';
  render(<PhoneView><p>x</p></PhoneView>);
  expect(screen.getByRole('group', { name: 'Phone view' })).toBeInTheDocument(); // default on at 1280
});

it('the frame carries no messaging-app words', () => {
  const { container } = render(<PhoneFrame time="09:41"><ChatThread crew={foldCrew(FIXTURE)} aspect="16:9" onPlay={() => {}} onSend={() => {}} onVoice={() => {}} /></PhoneFrame>);
  expect(container.innerHTML).not.toMatch(/whatsapp|telegram|messenger|imessage|signal/i);
  expect(screen.getByText('09:41')).toBeInTheDocument();
});

const ready = { filmId: 'film_0123456789ab', at: 'x', type: 'film.status', status: 'ready' } as FilmEvent;

it('adds exactly one ready bubble, and Play seeks to 0 and plays', async () => {
  const onPlay = vi.fn();
  const crew = crewReducer(foldCrew(FIXTURE), ready);
  render(<ChatThread crew={crew} filmStatus="ready" aspect="9:16" productUrl="/api/assets/ast_p" getPoster={async () => 'blob:poster'} onPlay={onPlay} onSend={() => {}} onVoice={() => {}} />);
  expect(screen.getAllByText('Your film is ready')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(onPlay).toHaveBeenCalled();
  expect(await screen.findByAltText('First frame of your film')).toHaveAttribute('src', 'blob:poster');
  expect(document.querySelector('.poster')).toHaveClass('a-9x16');
});

it('falls back to the product photo when the capture rejects', async () => {
  render(<ChatThread crew={foldCrew(FIXTURE)} filmStatus="ready" aspect="16:9" productUrl="/api/assets/ast_p" getPoster={async () => { throw new Error('no canvas'); }} onPlay={() => {}} onSend={() => {}} onVoice={() => {}} />);
  expect(await screen.findByAltText('First frame of your film')).toHaveAttribute('src', '/api/assets/ast_p');
});
