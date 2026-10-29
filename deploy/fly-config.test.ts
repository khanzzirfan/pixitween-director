import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const fly = readFileSync('fly.toml', 'utf8');

it('has the verified keys', () => {
  for (const re of [/primary_region = "iad"/, /dockerfile = "deploy\/Dockerfile"/, /internal_port = 8080/, /auto_stop_machines = "off"/, /min_machines_running = 1/, /path = "\/api\/health"/]) expect(fly).toMatch(re);
});

it('mounts the volume at /data and points the stores at it', () => {
  expect(fly).toMatch(/\[mounts\][\s\S]*source = "director_data"[\s\S]*destination = "\/data"/);
  expect(fly).toMatch(/DATA_DIR = "\/data"/);
  expect(fly).toMatch(/TRUST_FLY_CLIENT_IP = "(true|1)"/);
});

it('sets no secret', () => {
  for (const name of ['META_API_KEY', 'CLIPPY_TOKEN', 'CLIPPY_MCP_URL', 'DIRECTOR_PASSCODE']) expect(fly).not.toMatch(new RegExp(`^\\s*${name}\\s*=`, 'm'));
});
