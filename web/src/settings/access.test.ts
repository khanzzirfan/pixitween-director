import { afterEach, expect, it } from 'vitest';
import { MUSE_KEY_HEADER, PASSCODE_HEADER } from '@shared/api';
import { accessLabel, accessMode, credentialHeaders, saveAccess } from './access';

afterEach(() => localStorage.clear());

it('a Director code is sent on its own, and wins over a saved Muse key', () => {
  saveAccess({ code: 'studio', museKey: 'visitor-key-123' });
  expect(accessMode()).toBe('code');
  expect(credentialHeaders()).toEqual({ [PASSCODE_HEADER]: 'studio' });
});

it('sends the visitor key only when no code is saved', () => {
  saveAccess({ code: '', museKey: 'visitor-key-123' });
  expect(accessMode()).toBe('key');
  expect(credentialHeaders()).toEqual({ [MUSE_KEY_HEADER]: 'visitor-key-123' });
});

it('names a saved video key without sending it as the Muse key', () => {
  saveAccess({ code: '', museKey: '' });
  expect(accessLabel('none', { fal: true, higgsfield: false, revana: false })).toBe('Video key');
  expect(credentialHeaders()).toEqual({});
});

it('sends nothing when settings are empty', () => {
  saveAccess({ code: '  ', museKey: '' });
  expect(accessMode()).toBe('none');
  expect(credentialHeaders()).toEqual({});
});
