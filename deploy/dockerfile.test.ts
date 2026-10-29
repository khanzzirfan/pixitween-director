import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const docker = readFileSync('deploy/Dockerfile', 'utf8');
const ignore = readFileSync('.dockerignore', 'utf8');

it('starts from node 22 and installs ffmpeg without recommends', () => {
  expect(docker.match(/^FROM .+/m)![0]).toContain('node:22-bookworm-slim');
  expect(docker).toContain('apt-get install -y --no-install-recommends ffmpeg');
});

it('caches the dependency layer, sets the port and starts the server', () => {
  expect(docker.indexOf('COPY package.json package-lock.json')).toBeGreaterThan(-1);
  expect(docker.indexOf('COPY package.json package-lock.json')).toBeLessThan(docker.indexOf('COPY . .'));
  expect(docker).toContain('PORT=8080');
  expect(docker).toMatch(/^CMD \[.*start.*\]/m);
});

it('copies no env file and bakes in no secret', () => {
  expect(docker).not.toMatch(/COPY .*\.env/);
  for (const line of docker.split('\n').filter((l) => /^\s*(ENV|ARG)\b/.test(l))) expect(line).not.toMatch(/KEY|TOKEN|PASSCODE/);
});

it('keeps secrets and local data out of the image', () => {
  const lines = ignore.split('\n');
  for (const need of ['.env', 'data', 'debug', 'node_modules', '.ralph-tui']) expect(lines).toContain(need);
});
