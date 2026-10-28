import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RecordedResponse {
  status: number;
  contentType: string;
  bodyText: string;
}
export interface FormDescription {
  fields: Record<string, string>;
  files: Record<string, { type: string; sha256: string }>;
}

export class ReplayMissError extends Error {
  readonly key: string;
  constructor(method: string, path: string, key: string) {
    super(`replay miss: ${method} ${path} key=${key}`);
    this.name = 'ReplayMissError';
    this.key = key;
  }
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Replace `data:<mime>;base64,<payload>` by `data:<mime>;sha256=<hash of the decoded bytes>`, recursively sorting keys. */
function canonical(v: unknown): unknown {
  if (typeof v === 'string') {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(v);
    return m ? `data:${m[1]};sha256=${sha256(Buffer.from(m[2]!, 'base64'))}` : v;
  }
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}

export function requestKey(r: { method: string; path: string; json?: unknown; form?: FormDescription }): string {
  const body = r.form ? canonical({ fields: r.form.fields, files: r.form.files }) : canonical(r.json ?? null);
  return sha256(`${r.method} ${r.path}\n${JSON.stringify(body)}`);
}

export async function describeForm(form: FormData): Promise<FormDescription> {
  const out: FormDescription = { fields: {}, files: {} };
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') out.fields[name] = value;
    else out.files[name] = { type: value.type, sha256: sha256(Buffer.from(await value.arrayBuffer())) };
  }
  return out;
}

export async function readReplay(dir: string, key: string): Promise<RecordedResponse | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8')) as RecordedResponse;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

export async function writeReplay(dir: string, key: string, rec: RecordedResponse): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.json`), JSON.stringify({ status: rec.status, contentType: rec.contentType, bodyText: rec.bodyText }, null, 2) + '\n');
}
