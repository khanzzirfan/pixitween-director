import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import type { MetaClients } from '@shared/ports';
import type { EmitInput, ToolCtx, ToolDef } from '@shared/tools';
import { createEventBus } from '../events/bus';
import { createLedger } from '../ledger';
import { lightValidator } from '../engine/validate';
import { createAssetStore } from '../store/asset-store';
import { createFilmStore } from '../store/film-store';
import { RegistryError, allTools, createRegistry, makeToolCtx } from './registry';

const F = 'film_aaaaaaaaaaaa';

it('makeToolCtx stamps filmId and at on emit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
  const bus = createEventBus(dir);
  const ctx = makeToolCtx(
    {
      films: createFilmStore({ dir, validator: lightValidator }),
      assets: createAssetStore({ dir, publicBaseUrl: 'http://x' }),
      meta: {} as MetaClients,
      ledger: createLedger({ dir, emit: () => undefined }),
      bus,
    },
    F,
  );
  ctx.emit({ type: 'film.status', status: 'planning' });
  await new Promise((r) => setTimeout(r, 50));
  const [env] = await bus.replay(F);
  expect(env!.event).toMatchObject({ type: 'film.status', filmId: F });
  expect(env!.event.at).toMatch(/^\d{4}-\d\d-\d\dT/);
});

const fakeCtx = () => {
  const events: EmitInput[] = [];
  return { events, ctx: { filmId: F, emit: (e: EmitInput) => events.push(e) } as unknown as ToolCtx };
};
const adder: ToolDef<{ a: number; b: number }> = {
  name: 'add', description: 'add', params: z.object({ a: z.number(), b: z.number() }),
  run: async (_c, { a, b }) => ({ ok: true, version: 3, data: a + b }),
};
const thrower: ToolDef = { name: 'boom', description: 'x', params: z.object({}), run: async () => { throw new Error('kaboom'); } };
const reg = createRegistry([[adder as ToolDef], [thrower]]);

it('runs a tool and emits one tool.call with the version', async () => {
  const { ctx, events } = fakeCtx();
  expect(await reg.run(ctx, 'add', { a: 1, b: 2 })).toEqual({ ok: true, version: 3, data: 3 });
  expect(events).toEqual([{ type: 'tool.call', name: 'add', args: { a: 1, b: 2 }, ok: true, version: 3 }]);
});

it('rejects bad args with zodIssues', async () => {
  const { ctx, events } = fakeCtx();
  const r = await reg.run(ctx, 'add', { a: 'x', b: 2 });
  expect(r.ok).toBe(false);
  expect(!r.ok && Array.isArray(r.zodIssues) && (r.zodIssues as unknown[]).length > 0).toBe(true);
  expect(!r.ok && r.error.startsWith('a:')).toBe(true);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ ok: false });
});

it('handles unknown tools and thrown errors', async () => {
  const { ctx, events } = fakeCtx();
  expect(await reg.run(ctx, 'nope', {})).toEqual({ ok: false, error: 'unknown_tool: nope' });
  expect(await reg.run(ctx, 'boom', {})).toEqual({ ok: false, error: 'kaboom' });
  expect(events).toHaveLength(2);
});

it('duplicate names make all() throw', () => {
  expect(() => createRegistry([[adder as ToolDef], [adder as ToolDef]]).all()).toThrow(RegistryError);
  expect(() => createRegistry([[adder as ToolDef], [adder as ToolDef]]).all()).toThrow(/add/);
});

it('the default registry has no duplicate names', () => {
  const names = allTools().map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
});
