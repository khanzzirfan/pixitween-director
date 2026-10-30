// Owned by S10. A fast offline scan of tracked text files for keys. It reports file and line, never the matched text.
import { ALLOWLIST, type Allow } from '../secrets-allowlist';
import { fail, pass, type CheckResult, type PreflightCtx } from '../types';

export const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  { name: 'base64-data-url', re: /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}/ },
  { name: 'key-assignment', re: /\b(META_API_KEY|MODEL_API_KEY|CLIPPY_TOKEN|DIRECTOR_PASSCODE|BASETEN_API_KEY)\s*[=:]\s*(?!undefined\b|null\b|process\b|env\b)[^\s#<$"'{]{8,}/ },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'signed-url', re: /[?&](Signature|Key-Pair-Id)=/ },
];

const BINARY = /\.(png|jpe?g|webp|gif|ico|svg|mp4|webm|mov|wav|mp3|ogg|m4a|ttf|otf|woff2?|pdf|zip|gz|tgz|bin|wasm|glb)$/i;
export const MAX_BYTES = 2 * 1024 * 1024;
const SKIP = new Set(['package-lock.json']);

export interface Hit {
  file: string;
  line: number;
  pattern: string;
}

export function scanText(file: string, text: string, allow: readonly Allow[] = ALLOWLIST): Hit[] {
  const hits: Hit[] = [];
  text.split('\n').forEach((line, i) => {
    const hit = PATTERNS.find((p) => p.re.test(line) && !allow.some((a) => a.path === file && a.pattern === p.name));
    if (hit) hits.push({ file, line: i + 1, pattern: hit.name });
  });
  return hits;
}

export function checkSecrets(ctx: PreflightCtx, allow: readonly Allow[] = ALLOWLIST): CheckResult[] {
  const out: CheckResult[] = [];
  let scanned = 0;
  for (const file of ctx.tracked) {
    if (BINARY.test(file) || SKIP.has(file) || ctx.sizeOf(file) > MAX_BYTES) continue;
    const text = ctx.readText(file);
    if (text === undefined) continue;
    scanned++;
    for (const h of scanText(file, text, allow)) out.push(fail(`secrets:${h.file}:${h.line}:${h.pattern}`, 'a secret in a tracked file', `${h.file} line ${h.line} matches ${h.pattern}`));
  }
  return out.length ? out : [pass('secrets', 'no secrets in tracked files', `${scanned} files scanned`)];
}
