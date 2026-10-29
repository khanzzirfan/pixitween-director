import { Hono } from 'hono';
import { expect, it } from 'vitest';
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
