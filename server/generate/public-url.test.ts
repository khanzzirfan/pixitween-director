import { expect, it } from 'vitest';
import { PublicUrlError, assertPublicUrl, publicAssetUrl } from './public-url';

const ok = ['https://app.fly.dev', 'https://director.example.com:8443/x', 'https://172.15.0.1', 'https://172.32.0.1', 'https://8.8.8.8'];
const bad = ['http://app.fly.dev', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.5', 'https://172.16.0.1', 'https://172.31.255.1', 'https://192.168.1.2', 'https://169.254.1.1', 'https://[::1]', 'https://foo.local', 'https://a.localhost', 'https://0.0.0.0', 'https://[fd00::1]'];

it.each(ok)('accepts %s', (u) => expect(() => assertPublicUrl(u)).not.toThrow());
it.each(bad)('rejects %s', (u) => expect(() => assertPublicUrl(u)).toThrow(PublicUrlError));

it('joins base and path and explains refusals', () => {
  expect(publicAssetUrl('https://app.fly.dev/', '/api/assets/a1')).toBe('https://app.fly.dev/api/assets/a1');
  expect(() => publicAssetUrl(undefined, '/x')).toThrow(/PUBLIC_BASE_URL is not set/);
  expect(() => assertPublicUrl('https://localhost')).toThrow(/Got localhost/);
});
