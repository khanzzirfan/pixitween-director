import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClippyError, createClippyClient } from './mcp';
import { startFakeClippyServer, type FakeClippyServerOptions } from './test-server';

let srv: Awaited<ReturnType<typeof startFakeClippyServer>> | undefined;
let client: ReturnType<typeof createClippyClient> | undefined;
afterEach(async () => {
  await client?.close();
  await srv?.close();
  srv = client = undefined;
});

async function setup(o: FakeClippyServerOptions = {}, c: { timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  srv = await startFakeClippyServer(o);
  client = createClippyClient({ url: srv.url, token: 'test-token', sleep: async () => undefined, ...c });
  return { srv, client };
}
const statusCalls = () => srv!.toolCalls.filter((c) => c.tool === 'get_live_animate_status').length;
const fast = { model: 'fast-h3', prompt: 'x', sourceImageUrl: 'https://a.example/i.jpg', durationSec: 5.2, aspect: '16:9' } as const;

describe('client', () => {
  it('reads the balance with a Bearer header', async () => {
    const { client } = await setup({ balance: 77 });
    expect((await client.getCreditBalance()).currentBalance).toBe(77);
    expect(srv!.authHeaders.every((h) => h === 'Bearer test-token')).toBe(true);
  });
  it('submits and reads status', async () => {
    const { client } = await setup();
    expect(await client.animateImage(fast)).toEqual({ jobId: 'job_test_1', status: 'rendering', estimatedCredits: 25 });
    expect(srv!.toolCalls.find((c) => c.tool === 'animate_image')!.args).toMatchObject({ model: 'fast-h3', durationSec: 5.2 });
    expect((await client.getLiveAnimateStatus('job_test_1')).resultUrl).toContain('https://');
    expect(await client.listLiveAnimateModels()).toMatchObject({ models: ['fast-h3', 'fast-h3-omni'] });
  });
  it('turns an isError result into a ClippyError without leaking the token', async () => {
    const { client } = await setup({ toolError: { tool: 'get_credit_balance', text: 'pro_plan_required for test-token' } });
    const e = (await client.getCreditBalance().catch((err) => err)) as ClippyError;
    expect(e).toBeInstanceOf(ClippyError);
    expect(e.isToolError).toBe(true);
    expect(e.message).toContain('get_credit_balance');
    expect(e.message).toContain('pro_plan_required');
    expect(e.message).not.toContain('test-token');
  });
  it('rejects non-JSON results as unexpected', async () => {
    const { client } = await setup({ rawText: { tool: 'get_credit_balance', text: 'not json' } });
    await expect(client.getCreditBalance()).rejects.toMatchObject({ message: 'unexpected response' });
  });
  it('closes cleanly', async () => {
    const { client } = await setup();
    await client.getCreditBalance();
    await expect(client.close()).resolves.toBeUndefined();
  });
});

describe('timeouts and retries', () => {
  it('retries a read once after a transport failure', async () => {
    const sleep = vi.fn(async () => undefined);
    const { client } = await setup({ failFirst: { tool: 'get_live_animate_status', times: 1 } }, { sleep });
    expect((await client.getLiveAnimateStatus('job_test_1')).status).toBe('done');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(statusCalls()).toBe(1); // the failed request never reached the tool
  });
  it('never retries animate_image', async () => {
    const { client } = await setup({ failFirst: { tool: 'animate_image', times: 5 } });
    await expect(client.animateImage(fast)).rejects.toBeInstanceOf(ClippyError);
    expect(srv!.toolCalls.filter((c) => c.tool === 'animate_image')).toHaveLength(0);
  });
  it('does not retry a tool error on a read', async () => {
    const sleep = vi.fn(async () => undefined);
    const { client } = await setup({ toolError: { tool: 'get_live_animate_status', text: 'nope' } }, { sleep });
    await expect(client.getLiveAnimateStatus('j')).rejects.toMatchObject({ isToolError: true });
    expect(sleep).not.toHaveBeenCalled();
    expect(statusCalls()).toBe(1);
  });
  it('times out when the server never answers', async () => {
    const { client } = await setup({ hang: 'get_credit_balance' }, { timeoutMs: 50 });
    const t0 = Date.now();
    await expect(client.getCreditBalance()).rejects.toMatchObject({ message: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
