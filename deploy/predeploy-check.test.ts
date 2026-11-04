import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { checkDeploy, scanForKeys } from './predeploy-check';

function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'predeploy-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}
const clean = { 'web/dist/index.html': '<html></html>', '.dockerignore': '.env\ndata\n', 'fly.toml': 'app = "pixitween-director"\n', 'deploy/Dockerfile': 'FROM node:22-bookworm-slim\n' };

it('flags bearer tokens, key names in a bundle and secret assignments', () => {
  expect(scanForKeys('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123')).toHaveLength(1);
  expect(scanForKeys('Bearer short')).toEqual([]);
  expect(scanForKeys('const x = "META_API_KEY"').length).toBeGreaterThan(0);
  expect(scanForKeys('CLIPPY_TOKEN=abc123', { serverNames: false })).toHaveLength(1);
  expect(scanForKeys('fly secrets set META_API_KEY=<your key>', { serverNames: false })).toEqual([]);
});

it('needs the built web app', () => {
  const r = checkDeploy(root({ '.dockerignore': '.env\ndata\n' }));
  expect(r.errors.join(' ')).toContain('web/dist/index.html');
});

it('passes a clean root and reminds you to rename the app', () => {
  const r = checkDeploy(root(clean));
  expect(r.errors).toEqual([]);
  expect(r.warnings.join(' ')).toContain('rename the app');
});

it('fails on a leaked key in the bundle or the config, and on a thin dockerignore', () => {
  expect(checkDeploy(root({ ...clean, 'web/dist/app.js': 'x="META_API_KEY"' })).errors.length).toBeGreaterThan(0);
  expect(checkDeploy(root({ ...clean, 'fly.toml': 'DIRECTOR_PASSCODE = "hunter2"' })).errors.length).toBeGreaterThan(0);
  expect(checkDeploy(root({ ...clean, '.dockerignore': 'node_modules\n' })).errors.join(' ')).toContain("'.env'");
});
