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
