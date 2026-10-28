import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ScanOptions {
  forbiddenNames: string[];
  forbiddenValues: string[];
}
export interface Finding {
  file: string;
  kind: 'name' | 'value' | 'bearer' | 'sk';
  match: string;
}

const EXT = /\.(js|css|html|map)$/;
const SK = /sk-[A-Za-z0-9_-]{20,}/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

export function scanDirectory(dir: string, opts: ScanOptions): Finding[] {
  const findings: Finding[] = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const name of opts.forbiddenNames) if (text.includes(name)) findings.push({ file, kind: 'name', match: name });
    for (const value of opts.forbiddenValues) if (value && text.includes(value)) findings.push({ file, kind: 'value', match: '<redacted value>' });
    if (text.includes('Bearer ')) findings.push({ file, kind: 'bearer', match: 'Bearer ' });
    const sk = SK.exec(text);
    if (sk) findings.push({ file, kind: 'sk', match: sk[0].slice(0, 6) + '…' });
  }
  return findings;
}

const NAMES = ['META_API_KEY', 'MODEL_API_KEY', 'CLIPPY_TOKEN', 'DIRECTOR_PASSCODE'];

function main(): number {
  const dir = fileURLToPath(new URL('../web/dist', import.meta.url));
  const values = NAMES.map((n) => process.env[n] ?? '').filter((v) => v.length >= 8);
  const findings = scanDirectory(dir, { forbiddenNames: NAMES, forbiddenValues: values });
  for (const f of findings) console.error(`LEAK ${f.kind}: ${f.match} in ${f.file}`);
  console.log(findings.length ? `${findings.length} finding(s)` : 'bundle clean');
  return findings.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
