import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkLicense } from './license';

it('fails with a missing file', () => {
  const [r] = checkLicense(makeCtx({}));
  expect(r).toMatchObject({ id: 'license', status: 'fail' });
  expect(r!.detail).toContain('missing');
});
it('fails for MIT and passes for Apache 2.0', () => {
  expect(checkLicense(makeCtx({ LICENSE: 'MIT License\n\nPermission is hereby granted' }))[0]!.status).toBe('fail');
  expect(checkLicense(makeCtx({ LICENSE: '                                 Apache License\n                           Version 2.0, January 2004' }))[0]!.status).toBe('pass');
});
