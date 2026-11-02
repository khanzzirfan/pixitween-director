import { afterEach, expect, it } from 'vitest';
import * as connect from './s07-connect';

const saved = { url: process.env.CLIPPY_MCP_URL, token: process.env.CLIPPY_TOKEN };
afterEach(() => {
  for (const [k, v] of [['CLIPPY_MCP_URL', saved.url], ['CLIPPY_TOKEN', saved.token]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

it('is free and says so', () => {
  expect(connect.estimateUsd()).toBe(0);
  expect(connect.describe()).toContain('no credit is spent');
});
it('summarises without leaking secrets', () => {
  const s = connect.summariseConnect({ models: ['fast-h3', 'fast-h3-omni'], balance: { currentBalance: 120 }, timings: [340, 210] });
  expect(s).toContain('fast-h3-omni');
  expect(s).toContain('120');
  expect(s).toContain('340');
  expect(s).not.toMatch(/Bearer|token/i);
});
it('refuses to run without the token and opens no connection', async () => {
  process.env.CLIPPY_MCP_URL = 'https://clippy.example.test/mcp';
  delete process.env.CLIPPY_TOKEN;
  await expect(connect.run({ env: {} as never, log: () => undefined })).rejects.toThrow(/CLIPPY_TOKEN/);
});
