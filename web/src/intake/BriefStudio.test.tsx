import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import * as lineup from '../lineup/api';
import { BriefStudio } from './BriefStudio';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

const CSV = 'id,title,price,sale_price,currency,image_link\na,Rose Gold Orchid,49,,USD,orchid.png\nb,Forest Oud,95,,USD,oud.png\n';
const drop = (files: File[]) => fireEvent.drop(screen.getByTestId('brief-studio'), { dataTransfer: { files } });

it('shows what a dropped CSV holds, asks only for the missing photo, then starts a line-up of films', async () => {
  const run = vi.spyOn(lineup, 'createLineup').mockResolvedValue({ lineupId: 'lin_1', filmIds: ['film_1', 'film_2'] });
  render(<BriefStudio />);
  drop([new File([CSV], 'feed.csv', { type: 'text/csv' })]);
  expect(await screen.findByText(/1 of 2 needs a photo|2 of 2 need a photo/)).toBeInTheDocument();
  expect(screen.getByText('Rose Gold Orchid')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Make film' })).toBeDisabled();
  drop([new File(['x'], 'orchid.png', { type: 'image/png' }), new File(['x'], 'oud.png', { type: 'image/png' })]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Make film' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: '16:9' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Make film' }));
  await waitFor(() => expect(run).toHaveBeenCalled());
  const form = run.mock.calls[0][0] as FormData;
  expect(form.get('aspect')).toBe('9:16');
  expect(form.getAll('photos')).toHaveLength(2);
  await waitFor(() => { expect(window.location.search).toContain('lineup=lin_1'); expect(window.location.search).toContain('film=film_1'); });
});

it('a film needs words before Make film, even with a photo', async () => {
  render(<BriefStudio />);
  drop([new File(['x'], 'can.png', { type: 'image/png' })]);
  expect(await screen.findByText(/Got your photo/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Make film' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'sunny and fast' } });
  expect(screen.getByRole('button', { name: 'Make film' })).toBeEnabled();
});

it('pointing at a product puts a reference into the chat', async () => {
  render(<BriefStudio />);
  drop([new File([CSV], 'feed.csv', { type: 'text/csv' })]);
  fireEvent.click(await screen.findByText('Forest Oud'));
  expect(screen.getByLabelText('Message')).toHaveValue('[Forest Oud] ');
});

const png = (name: string) => new File(['x'], name, { type: 'image/png' });

it('several photos are one film that cuts between them, the first as the hero', async () => {
  const create = vi.spyOn(client.api, 'createFilm').mockResolvedValue({ filmId: 'film_1', queue: { state: 'running' } } as never);
  render(<BriefStudio />);
  drop([png('a.png'), png('b.png'), png('c.png')]);
  expect(await screen.findByText(/3 photos: one film that cuts between them/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'three views of one mug' } });
  fireEvent.click(screen.getByRole('button', { name: 'Make film' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  const form = create.mock.calls[0][0] as FormData;
  expect(form.getAll('photos').map((f) => (f as File).name)).toEqual(['a.png', 'b.png', 'c.png']);
  expect(form.get('brief')).toBe('three views of one mug');
  await waitFor(() => expect(window.location.search).toContain('film=film_1'));
});

it('no photo is still one film: the words are enough and the server makes the photo', async () => {
  const create = vi.spyOn(client.api, 'createFilm').mockResolvedValue({ filmId: 'film_2', queue: { state: 'running' } } as never);
  render(<BriefStudio />);
  expect(screen.getByRole('button', { name: 'Make film' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a ceramic mug at sunrise' } });
  expect(await screen.findByText(/I will make one from your description/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Make film' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect((create.mock.calls[0][0] as FormData).getAll('photos')).toHaveLength(0);
});

it('a spoken brief makes the film too: the recording goes up as audio, not as words', async () => {
  class FakeRecorder {
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    static isTypeSupported = () => true;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } });
  const create = vi.spyOn(client.api, 'createFilm').mockResolvedValue({ filmId: 'film_1', queue: { state: 'running' } } as never);
  render(<BriefStudio />);
  fireEvent.click(screen.getByRole('button', { name: 'Record a voice brief' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
  expect(await screen.findByRole('button', { name: 'Remove recording' })).toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Make film' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  const form = create.mock.calls[0][0] as FormData;
  expect(form.get('audio')).toBeInstanceOf(File);
  expect(form.get('brief')).toBeNull();
  vi.unstubAllGlobals();
});

it('a CSV has no mic: a catalog brief is written', async () => {
  render(<BriefStudio />);
  drop([new File([CSV], 'feed.csv', { type: 'text/csv' })]);
  await screen.findByText('Rose Gold Orchid');
  expect(screen.queryByRole('button', { name: 'Record a voice brief' })).toBeNull();
});
