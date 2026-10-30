import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkEngine, isRegistrySpec } from './engine';

const lockWith = (entry: Record<string, string> | undefined) => JSON.stringify({ lockfileVersion: 3, packages: entry ? { 'node_modules/reacthub-pixitweenjs': entry } : {} });
const pkgWith = (spec: string) => JSON.stringify({ dependencies: { 'reacthub-pixitweenjs': spec } });
const good = { version: '0.3.0-alpha.5', resolved: 'https://registry.npmjs.org/reacthub-pixitweenjs/-/reacthub-pixitweenjs-0.3.0-alpha.5.tgz', integrity: 'sha512-abc' };
const byId = (rs: ReturnType<typeof checkEngine>) => Object.fromEntries(rs.map((r) => [r.id, r]));

it('knows a registry spec from a path, a git URL or a link', () => {
  for (const s of ['0.3.0-alpha.1', '^0.3.0-alpha.1', 'alpha', '~1.2.3', '>=1.0.0']) expect(isRegistrySpec(s), s).toBe(true);
  for (const s of ['file:../reacthub-pixitweenjs', 'github:khanzzirfan/x', '../x', 'link:../x', 'https://x.example/e.tgz', 'git+ssh://git@x/y.git', '']) expect(isRegistrySpec(s), s).toBe(false);
});

it('passes both with a registry version, a registry resolved URL and an integrity', () => {
  const r = byId(checkEngine(makeCtx({ 'package.json': pkgWith('0.3.0-alpha.5'), 'package-lock.json': lockWith(good) })));
  expect(r['engine.dependency']!.status).toBe('pass');
  expect(r['engine.lockfile']!.status).toBe('pass');
});

it('fails the lockfile when the entry has no integrity', () => {
  const { integrity: _i, ...noIntegrity } = good;
  const r = byId(checkEngine(makeCtx({ 'package.json': pkgWith('0.3.0-alpha.5'), 'package-lock.json': lockWith(noIntegrity) })));
  expect(r['engine.lockfile']!.status).toBe('fail');
  expect(r['engine.dependency']!.status).toBe('pass');
});

it('fails both for a file: dependency whose lock entry has no resolved', () => {
  const r = byId(checkEngine(makeCtx({ 'package.json': pkgWith('file:../reacthub-pixitweenjs'), 'package-lock.json': lockWith({ version: '0.3.0-alpha.5' }) })));
  expect(r['engine.dependency']!.status).toBe('fail');
  expect(r['engine.lockfile']!.status).toBe('fail');
});

it('fails when there is no lockfile or no dependency', () => {
  expect(byId(checkEngine(makeCtx({ 'package.json': pkgWith('alpha') })))['engine.lockfile']!.detail).toContain('npm install');
  expect(byId(checkEngine(makeCtx({ 'package.json': '{}', 'package-lock.json': lockWith(good) })))['engine.dependency']!.status).toBe('fail');
});
