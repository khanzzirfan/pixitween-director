import { afterEach, expect, it } from 'vitest';
import { glimmerReviewImages } from './review';
import { startMockOllama, type MockOllama } from './mock-server';

let mock: MockOllama | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const ok = { body: { message: { role: 'assistant', content: '{"pass":true,"issues":[]}' } } };

it('sends the images as base64 on one user message', async () => {
  mock = await startMockOllama([ok]);
  const a = Buffer.from('first image');
  const b = Buffer.from('second image');
  const out = await glimmerReviewImages([a, b], 'check these', { type: 'object' }, { baseUrl: mock.baseUrl, model: 'm' });
  expect(out).toEqual({ pass: true, issues: [] });
  const body = mock.requests[0]!.body as { messages: Array<{ role: string; content: string; images: string[] }>; format: unknown; think: boolean };
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0]!.images).toEqual([a.toString('base64'), b.toString('base64')]);
  expect(body.format).toEqual({ type: 'object' });
  expect(body.think).toBe(false);
});

it('asks for plain json without a schema', async () => {
  mock = await startMockOllama([ok]);
  await glimmerReviewImages([Buffer.from('x')], 'p', undefined, { baseUrl: mock.baseUrl, model: 'm' });
  expect(mock.requests[0]!.body.format).toBe('json');
});
