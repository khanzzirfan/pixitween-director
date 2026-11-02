import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkSecrets, scanText } from './secrets';

const ids = (text: string) => scanText('a.ts', text).map((h) => h.pattern);

it('flags a key assignment with a value, and not an empty one', () => {
  expect(ids('export META_API_KEY=abcd1234efgh5678')).toEqual(['key-assignment']);
  expect(ids('META_API_KEY=')).toEqual([]);
  expect(ids('CLIPPY_TOKEN=${CLIPPY_TOKEN}')).toEqual([]);
  expect(ids('DIRECTOR_PASSCODE=<your passcode here>')).toEqual([]);
  expect(ids('createBackend({ BASETEN_API_KEY: undefined, META_MAX_INFLIGHT: 2 })')).toEqual([]);
  expect(ids('const key = { META_API_KEY: process.env.META_API_KEY }')).toEqual([]);
});

it('has a positive and a negative line for each of the other patterns', () => {
  expect(ids('const k = "sk-abcdefghijklmnopqrstuvwx"')).toEqual(['openai-style-key']);
  expect(ids('sk-short')).toEqual([]);
  expect(ids(`AKIA${'ABCDEFGHIJKLMNOP'}`)).toEqual(['aws-access-key-id']);
  expect(ids('AKIA-not-a-key')).toEqual([]);
  expect(ids(`token ghp_${'a'.repeat(36)}`)).toEqual(['github-token']);
  expect(ids('ghp_short')).toEqual([]);
  expect(ids(`data:image/png;base64,${'A'.repeat(220)}`)).toEqual(['base64-data-url']);
  expect(ids('data:image/png;base64,AAAA')).toEqual([]);
  expect(ids('-----BEGIN RSA PRIVATE KEY-----')).toEqual(['private-key-block']);
  expect(ids('-----BEGIN PUBLIC KEY-----')).toEqual([]);
  expect(ids('https://x.example/a.png?Signature=abc')).toEqual(['signed-url']);
  expect(ids('https://x.example/a.png?size=2')).toEqual([]);
});

it('does not flag Bearer <token>, and flags Bearer with 24 characters', () => {
  expect(ids('Authorization: Bearer <token>')).toEqual([]);
  expect(ids(`Authorization: Bearer ${'a1'.repeat(12)}`)).toEqual(['bearer-token']);
});

it('reports file and line and never the secret text', () => {
  const secret = 'abcd1234efgh5678';
  const rs = checkSecrets(makeCtx({ 'a.ts': `line one\nexport META_API_KEY=${secret}\n` }));
  expect(rs).toHaveLength(1);
  expect(rs[0]).toMatchObject({ status: 'fail' });
  expect(rs[0]!.id.endsWith(':key-assignment')).toBe(true);
  expect(rs[0]!.detail).toContain('a.ts');
  expect(rs[0]!.detail).toContain('2');
  expect(rs[0]!.detail).not.toContain(secret);
  expect(rs[0]!.id).not.toContain(secret);
});

it('skips a 3 MB text file and a png even when they hold a match', () => {
  const line = 'export META_API_KEY=abcd1234efgh5678';
  const rs = checkSecrets(makeCtx({ 'big.txt': line, 'logo.png': line }, { sizes: { 'big.txt': 3 * 1024 * 1024 } }));
  expect(rs).toHaveLength(1);
  expect(rs[0]!.status).toBe('pass');
});

it('gives one fail per line even when two patterns match it', () => {
  const rs = checkSecrets(makeCtx({ 'a.ts': `META_API_KEY=abcd1234efgh5678 sk-${'a'.repeat(30)}` }));
  expect(rs).toHaveLength(1);
});

it('lets an allowlisted pair through', () => {
  const rs = checkSecrets(makeCtx({ 'a.ts': 'META_API_KEY=abcd1234efgh5678' }), [{ path: 'a.ts', pattern: 'key-assignment', why: 'a documented example' }]);
  expect(rs[0]!.status).toBe('pass');
});
