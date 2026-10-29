import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PushToTalk } from './PushToTalk';

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  FakeRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop() {} }] }) } });
});
afterEach(() => vi.unstubAllGlobals());

it('records while Space is held on the page and posts one blob on release', async () => {
  const onVoice = vi.fn().mockResolvedValue(undefined);
  render(<PushToTalk onVoice={onVoice} />);
  await act(async () => void fireEvent.keyDown(window, { code: 'Space' }));
  await waitFor(() => expect(screen.getByText('Listening…')).toBeInTheDocument());
  await act(async () => void fireEvent.keyUp(window, { code: 'Space' }));
  await waitFor(() => expect(onVoice).toHaveBeenCalledTimes(1));
  expect(onVoice.mock.calls[0]![0]).toBeInstanceOf(Blob);
  expect(await screen.findByText('Sent')).toBeInTheDocument();
});

it('ignores Space typed into a textarea', async () => {
  render(
    <>
      <textarea aria-label="t" />
      <PushToTalk onVoice={vi.fn()} />
    </>,
  );
  await act(async () => void fireEvent.keyDown(screen.getByLabelText('t'), { code: 'Space' }));
  expect(FakeRecorder.instances).toHaveLength(0);
});

it('is disabled with a reason when the microphone is blocked', async () => {
  (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('denied'));
  render(<PushToTalk onVoice={vi.fn()} />);
  await act(async () => void fireEvent.keyDown(window, { code: 'Space' }));
  expect(await screen.findByText('Microphone blocked')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Push to talk' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(/Allow the microphone/);
});

it('holds the button with the pointer', async () => {
  const onVoice = vi.fn().mockResolvedValue(undefined);
  render(<PushToTalk onVoice={onVoice} />);
  const b = screen.getByRole('button', { name: 'Push to talk' });
  await act(async () => void fireEvent.pointerDown(b));
  await waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
  await act(async () => void fireEvent.pointerUp(b));
  await waitFor(() => expect(onVoice).toHaveBeenCalled());
});
