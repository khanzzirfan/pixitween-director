import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChatThread } from './ChatThread';
import { foldCrew } from './crewReducer';
import { FIXTURE } from './test-fixture';

it('renders the user message on the right and the showrunner on the left, in event order', () => {
  render(<ChatThread crew={foldCrew(FIXTURE)} aspect="16:9" onPlay={() => {}} onSend={() => {}} onVoice={() => {}} />);
  const bubbles = [...document.querySelectorAll('.bubble')].map((b) => `${b.classList.contains('you') ? 'you' : 'crew'}:${b.querySelector('p')?.textContent ?? ''}`);
  expect(bubbles[0]).toBe('crew:Four scenes, four builders. Starting now.');
  expect(bubbles[1]).toBe('you:add a sunset scene after scene 2');
  expect(bubbles[2]).toBe('crew:Heard you. A sunset scene goes in after scene 2.');
});

it('sends the composer text on Enter and clears it', () => {
  const onSend = vi.fn();
  render(<ChatThread crew={foldCrew([])} aspect="16:9" onPlay={() => {}} onSend={onSend} onVoice={() => {}} />);
  const box = screen.getByLabelText('Message');
  fireEvent.change(box, { target: { value: 'make it warmer' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onSend).toHaveBeenCalledWith('make it warmer');
  expect(box).toHaveValue('');
});

it('answers an ask chip by sending it as a message', () => {
  const onSend = vi.fn();
  render(<ChatThread crew={foldCrew(FIXTURE)} aspect="16:9" onPlay={() => {}} onSend={onSend} onVoice={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
  expect(onSend).toHaveBeenCalledWith('Keep it');
});

it('shows a failed send', async () => {
  render(<ChatThread crew={foldCrew([])} aspect="16:9" onPlay={() => {}} onSend={() => Promise.reject(new Error('rate limited'))} onVoice={() => {}} />);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('rate limited');
});

it('opens with what the user first sent: the opener, the photo and the brief, before the crew\'s notes', () => {
  render(<ChatThread crew={foldCrew(FIXTURE)} aspect="16:9" onPlay={() => {}} onSend={() => {}} onVoice={() => {}} brief={{ text: 'a cold brew launch film', photoUrl: 'blob:can' }} />);
  const bubbles = [...document.querySelectorAll('.bubble')].map((b) => (b.querySelector('img') ? 'you:photo' : `${b.classList.contains('you') ? 'you' : 'crew'}:${b.querySelector('p')?.textContent ?? ''}`));
  expect(bubbles.slice(0, 3)).toEqual([expect.stringMatching(/^crew:What are we making/), 'you:photo', 'you:a cold brew launch film']);
  expect(screen.getByTestId('brief-photo').querySelector('img')).toHaveAttribute('src', 'blob:can');
  expect(bubbles[3]).toBe('crew:Four scenes, four builders. Starting now.');
});

it('shows a waiting bubble and holds typing while the film is still starting', () => {
  render(<ChatThread crew={foldCrew([])} aspect="16:9" onPlay={() => {}} onSend={() => {}} onVoice={() => {}} brief={{ text: 'hi' }} waiting="starting your film…" composerDisabled />);
  expect(screen.getByText('starting your film…')).toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toBeDisabled();
  expect(screen.getByText('hi')).toBeInTheDocument();
});

it('shows what was heard for a voice brief, and only the label until the words are known', () => {
  const { rerender } = render(<ChatThread crew={foldCrew([])} aspect="16:9" onPlay={() => {}} onSend={() => {}} onVoice={() => {}} brief={{ text: '', voice: true }} />);
  expect(screen.getByTestId('brief-text')).toHaveTextContent('🎙 Voice brief');
  rerender(<ChatThread crew={foldCrew([])} aspect="16:9" onPlay={() => {}} onSend={() => {}} onVoice={() => {}} brief={{ text: 'a fifteen second towel ad', voice: true }} />);
  expect(screen.getByTestId('brief-text')).toHaveTextContent('🎙 “a fifteen second towel ad”');
});
