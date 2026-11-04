import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientIp, hashIp } from './client-ip';

const ipFor = async (trust: boolean, headers: Record<string, string>) => {
  const app = new Hono();
  app.get('/', (c) => c.text(clientIp(c, { trustFlyHeader: trust })));
  return (await app.request('/', { headers })).text();
};

it('uses Fly-Client-IP only when told to', async () => {
  expect(await ipFor(true, { 'Fly-Client-IP': '203.0.113.7' })).toBe('203.0.113.7');
  expect(await ipFor(false, { 'Fly-Client-IP': '203.0.113.7' })).toBe('unknown');
});

it('never reads X-Forwarded-For', async () => {
  expect(await ipFor(false, { 'X-Forwarded-For': '198.51.100.1' })).toBe('unknown');
  expect(await ipFor(true, { 'X-Forwarded-For': '198.51.100.1' })).toBe('unknown');
});

it('hashes to eight stable hex characters', () => {
  expect(hashIp('203.0.113.7')).toMatch(/^[0-9a-f]{8}$/);
  expect(hashIp('203.0.113.7')).toBe(hashIp('203.0.113.7'));
  expect(hashIp('203.0.113.7')).not.toBe(hashIp('203.0.113.8'));
});

describe('warnings', () => {
  const saved = { ...process.env };
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules(); // the warned set is module level
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    delete process.env.FLY_APP_NAME;
  });
  afterEach(() => {
    warn.mockRestore();
    process.env = { ...saved };
  });
  const load = async (trust: boolean, headers: Record<string, string> = {}) => {
    const { clientIp: fresh } = await import('./client-ip');
    const app = new Hono();
    app.get('/', (c) => c.text(fresh(c, { trustFlyHeader: trust })));
    return async () => (await app.request('/', { headers })).text();
  };

  it('on Fly without TRUST_FLY_CLIENT_IP warns once', async () => {
    process.env.FLY_APP_NAME = 'demo';
    const get = await load(false);
    await get();
    await get();
    const fly = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('TRUST_FLY_CLIENT_IP'));
    expect(fly).toHaveLength(1);
  });

  it('on Fly with the header trusted does not warn and returns the header', async () => {
    process.env.FLY_APP_NAME = 'demo';
    const get = await load(true, { 'fly-client-ip': '203.0.113.9' });
    expect(await get()).toBe('203.0.113.9');
    expect(warn).not.toHaveBeenCalled();
  });

  it('off Fly does not warn', async () => {
    const get = await load(false);
    await get();
    expect(warn).not.toHaveBeenCalled();
  });

  it('in production with no connection info returns unknown and warns once', async () => {
    process.env.NODE_ENV = 'production';
    const get = await load(false);
    expect(await get()).toBe('unknown');
    await get();
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('no visitor address'))).toHaveLength(1);
  });

  it('in test returns unknown with no warning', async () => {
    process.env.NODE_ENV = 'test';
    const get = await load(false);
    expect(await get()).toBe('unknown');
    expect(warn).not.toHaveBeenCalled();
  });
});
