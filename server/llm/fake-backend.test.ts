import { expect, it } from 'vitest';
import { makeFakeBackend } from './fake-backend';

it('assigns call ids and falls back to DONE when exhausted', async () => {
  const b = makeFakeBackend([{ toolCalls: [{ name: 'a', args: {} }, { name: 'b', args: { x: 1 } }], content: 'hi' }]);
  const first = await b.chatWithTools([], []);
  expect(first.toolCalls.map((c) => c.id)).toEqual(['call_0_0', 'call_0_1']);
  expect(first.content).toBe('hi');
  const second = await b.chatWithTools([], []);
  expect(second).toMatchObject({ toolCalls: [], content: 'DONE' });
  expect(b.turns).toBe(2);
});
