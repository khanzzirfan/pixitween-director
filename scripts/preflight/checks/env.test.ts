import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkEnv } from './env';

const byId = (rs: ReturnType<typeof checkEnv>) => Object.fromEntries(rs.map((r) => [r.id, r]));

it('fails env.tracked when .env is tracked and passes when only .env.example is', () => {
  expect(byId(checkEnv(makeCtx({ '.env.example': '' }, { tracked: ['.env', '.env.example'] })))['env.tracked']!.status).toBe('fail');
  expect(byId(checkEnv(makeCtx({ '.env.example': '' }, { tracked: ['.env.example'] })))['env.tracked']!.status).toBe('pass');
  expect(byId(checkEnv(makeCtx({ '.env.example': '' }, { tracked: ['deploy/.env.production', '.env.example'] })))['env.tracked']!.status).toBe('fail');
});

it('fails env.example with the key name for a set token', () => {
  const r = byId(checkEnv(makeCtx({ '.env.example': 'CLIPPY_TOKEN=abc\n' })))['env.example']!;
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('CLIPPY_TOKEN');
});

it('passes env.example for empty secrets and for non-secret values', () => {
  const text = 'CLIPPY_TOKEN=\nGLIMMER_BASE_URL=http://localhost:11434\nDIRECTOR_PASSCODE=""\n# META_API_KEY=real-looking-value\nPORT=8787 # the port\nMETA_API_KEY= # your key\n';
  expect(byId(checkEnv(makeCtx({ '.env.example': text })))['env.example']!.status).toBe('pass');
});

it('fails env.example when the file is missing', () => {
  const r = byId(checkEnv(makeCtx({})))['env.example']!;
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('missing');
});
