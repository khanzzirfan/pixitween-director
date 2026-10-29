// Scans the build and deploy files for leaked keys before a deploy. Run: npx tsx deploy/predeploy-check.ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface KeyHit {
  pattern: string;
  index: number;
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['sk- key', /sk-[A-Za-z0-9]{20,}/g],
  ['bearer token', /Bearer\s+[A-Za-z0-9._-]{20,}/g],
  ['secret assignment', /(META_API_KEY|CLIPPY_TOKEN|DIRECTOR_PASSCODE)\s*[:=]\s*['"]?[A-Za-z0-9]/g],
];

/** `serverNames` also flags the bare name of a server-only variable, which must never appear in a web bundle. */
export function scanForKeys(text: string, opts: { serverNames?: boolean } = {}): KeyHit[] {
  const patterns = opts.serverNames === false ? SECRET_PATTERNS : [...SECRET_PATTERNS, ['server-only name', /META_API_KEY/g] as [string, RegExp]];
  return patterns.flatMap(([pattern, re]) => [...text.matchAll(re)].map((m) => ({ pattern, index: m.index ?? 0 })));
}

const TEXT = /\.(js|mjs|css|html|map|json|toml|txt)$/;
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : TEXT.test(name) ? [full] : [];
  });
}

export function checkDeploy(root: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dist = join(root, 'web', 'dist');
  if (!existsSync(join(dist, 'index.html'))) errors.push('web/dist/index.html is missing: run npm run build');
  else {
    for (const file of walk(dist)) {
      const hits = scanForKeys(readFileSync(file, 'utf8'));
      if (hits.length) errors.push(`${file.slice(root.length + 1)} contains ${hits.map((h) => h.pattern).join(', ')}`);
    }
  }
  for (const rel of ['deploy/Dockerfile', 'fly.toml']) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    // the bare variable name is fine in config comments; a value or a token is not
    const hits = scanForKeys(readFileSync(file, 'utf8'), { serverNames: false });
    if (hits.length) errors.push(`${rel} contains ${hits.map((h) => h.pattern).join(', ')}`);
  }
  const ignore = existsSync(join(root, '.dockerignore')) ? readFileSync(join(root, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim()) : [];
  for (const need of ['.env', 'data']) if (!ignore.includes(need)) errors.push(`.dockerignore does not list '${need}'`);
  const fly = existsSync(join(root, 'fly.toml')) ? readFileSync(join(root, 'fly.toml'), 'utf8') : '';
  if (/^app\s*=\s*"pixitween-director"/m.test(fly)) warnings.push('fly.toml still has app = "pixitween-director": rename the app');
  return { errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { errors, warnings } = checkDeploy(process.cwd());
  for (const w of warnings) console.warn(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  if (errors.length) process.exit(1);
  console.log('predeploy check passed');
}
