import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiRequestError, api } from '../api/client';
import NewFilm from '../panels/NewFilm';
import { ChatIntake } from './ChatIntake';

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
const photo = () => new File(['img'], 'can.png', { type: 'image/png' });
const attach = () => fireEvent.change(screen.getByLabelText('Product photo'), { target: { files: [photo()] } });

it('starts with the showrunner\'s opener and a disabled send until a photo is attached', () => {
  render(<ChatIntake />);
  expect(screen.getByText(/What are we making/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a cold brew launch film' } });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.getByText(/Attach a photo/)).toBeInTheDocument();
  attach();
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
});

it('with a photo but no words, send stays disabled', () => {
  render(<ChatIntake />);
  attach();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

it('creates the film once with the same form data the classic form sends', async () => {
  const create = vi.spyOn(api, 'createFilm').mockResolvedValue({ filmId: 'film_0123456789ab' } as never);
  render(<ChatIntake />);
  attach();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a cold brew launch film, bright and summery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const form = create.mock.calls[0]![0] as FormData;
  expect(form.get('product')).toBeInstanceOf(File);
  expect(form.get('aspect')).toBe('16:9');
  expect(form.get('brief')).toBe('a cold brew launch film, bright and summery');
  expect(form.get('title')).toBeNull();
  await waitFor(() => expect(window.location.search).toContain('film=film_0123456789ab'));
});

it('sends the chosen aspect and name', async () => {
  const create = vi.spyOn(api, 'createFilm').mockResolvedValue({ filmId: 'film_0123456789ab' } as never);
  render(<ChatIntake />);
  attach();
  fireEvent.click(screen.getByRole('button', { name: '9:16' }));
  fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Cold Co' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  const form = create.mock.calls[0]![0] as FormData;
  expect([form.get('aspect'), form.get('title')]).toEqual(['9:16', 'Cold Co']);
});

it('asks for the passcode after a 401 and stores it with the next send', async () => {
  const create = vi.spyOn(api, 'createFilm').mockRejectedValueOnce(new ApiRequestError(401, { error: 'unauthorized' })).mockResolvedValue({ filmId: 'film_0123456789ab' } as never);
  render(<ChatIntake />);
  attach();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const pass = await screen.findByLabelText('Passcode');
  expect(screen.getByRole('alert')).toHaveTextContent('unauthorized');
  fireEvent.change(pass, { target: { value: 'sesame' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(localStorage.getItem('director.passcode')).toBe('sesame');
});

it('NewFilm shows the chat when crew mode is on, the classic form when off or when the question fails', async () => {
  const answer = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => (ok ? new Response(JSON.stringify(body)) : Promise.reject(new Error('down')))));
  answer({ enabled: true });
  const { unmount } = render(<NewFilm film={null} events={[]} />);
  expect(await screen.findByText(/What are we making/)).toBeInTheDocument();
  unmount();
  answer({ enabled: false });
  const second = render(<NewFilm film={null} events={[]} />);
  await act(async () => void (await Promise.resolve()));
  expect(await screen.findByRole('button', { name: /Create my storyboard/ })).toBeInTheDocument();
  second.unmount();
  answer(null, false);
  render(<NewFilm film={null} events={[]} />);
  await new Promise((r) => setTimeout(r, 50));
  expect(await screen.findByRole('button', { name: /Create my storyboard/ })).toBeInTheDocument();
});
