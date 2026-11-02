import { createClippyClient } from '../../server/clippy/mcp';
import type { LiveScript } from './run';

export const describe: LiveScript['describe'] = () =>
  'Connects to Clippy over MCP (needs CLIPPY_MCP_URL and CLIPPY_TOKEN), lists the live-animate models and reads the credit balance. It only reads: no job is created and no credit is spent.';

export const estimateUsd: LiveScript['estimateUsd'] = () => 0;

export interface ConnectResults {
  models: unknown;
  balance: { currentBalance: number };
  timings: { models: number; balance: number };
}

/** Pure text summary: never prints the token or the URL's query. */
export function summariseConnect(r: { models: unknown; balance: { currentBalance: number }; timings: number[] | { models: number; balance: number } }): string {
  const names = Array.isArray(r.models) ? r.models : (r.models as { models?: unknown[] } | undefined)?.models ?? [];
  const list = names.map((m) => (typeof m === 'string' ? m : String((m as { name?: string; id?: string }).name ?? (m as { id?: string }).id ?? '?')));
  const t = Array.isArray(r.timings) ? { models: r.timings[0], balance: r.timings[1] } : r.timings;
  return [`models: ${list.join(', ') || '(none)'}`, `credit balance: ${r.balance.currentBalance}`, `list models: ${t.models} ms, balance: ${t.balance} ms`].join('\n');
}

export const run: LiveScript['run'] = async ({ log }) => {
  for (const name of ['CLIPPY_MCP_URL', 'CLIPPY_TOKEN'] as const) {
    if (!process.env[name]) throw new Error(`${name} is not set. Add it to .env, then run again.`);
  }
  const client = createClippyClient({ url: process.env.CLIPPY_MCP_URL!, token: process.env.CLIPPY_TOKEN! });
  try {
    const t0 = Date.now();
    const models = await client.listLiveAnimateModels();
    const t1 = Date.now();
    const balance = await client.getCreditBalance();
    const t2 = Date.now();
    log(summariseConnect({ models, balance, timings: { models: t1 - t0, balance: t2 - t1 } }));
  } finally {
    await client.close();
  }
};
