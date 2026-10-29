import { expect, it, vi } from 'vitest';
import type { MetaClients } from '@shared/ports';
import { priceSpark } from '../pricing';
import { createWonderBackend } from './wonder-backend';

it('is an LlmBackend with id wonder that names its model in the request', async () => {
  const chat = vi.fn(async (_req: unknown) => ({ toolCalls: [], content: 'ok', ms: 5, model: 'muse-wonder-1.0' }));
  const b = createWonderBackend({ meta: { chat } as unknown as MetaClients['spark'], model: 'muse-wonder-1.0' });
  expect(b.id).toBe('wonder');
  await b.chatWithTools([{ role: 'user', content: 'hi' }], []);
  expect(chat.mock.calls[0]![0] as object).toMatchObject({ model: 'muse-wonder-1.0', tool_choice: 'auto' });
});

it('prices muse-wonder-1.0 at $4 in and $20 out per million tokens', () => {
  expect(priceSpark('muse-wonder-1.0', 8000, 1500)).toBeCloseTo(0.062, 6);
});
