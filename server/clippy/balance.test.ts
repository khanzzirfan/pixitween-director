import { expect, it } from 'vitest';
import { createBalanceReader } from './balance';
import { makeFakeClippy } from './fake';
import type { ClippyClient } from './mcp';

it('caches for the ttl', async () => {
  const fake = makeFakeClippy({ balance: 120 });
  let t = 0;
  const r = createBalanceReader(fake, { now: () => t });
  expect(await r.read()).toBe(120);
  t = 10_000;
  expect(await r.read()).toBe(120);
  expect(fake.calls).toHaveLength(1);
  t = 31_000;
  await r.read();
  expect(fake.calls).toHaveLength(2);
});
it('never throws', async () => {
  const failing = { getCreditBalance: async () => { throw new Error('down'); } } as unknown as ClippyClient;
  expect(await createBalanceReader(failing).read()).toBeUndefined();
  expect(await createBalanceReader(undefined).read()).toBeUndefined();
  const odd = { getCreditBalance: async () => ({ currentBalance: 'abc' }) } as unknown as ClippyClient;
  expect(await createBalanceReader(odd).read()).toBeUndefined();
});
