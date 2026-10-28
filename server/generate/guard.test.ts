import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeFakeClippy } from '../clippy/fake';
import type { AnimateImageArgs } from '../clippy/types';
import { createApprovalStore, type ConsumedApproval } from './approval';
import { idempotencyKeyFor, submitApproved } from './guard';

const SERVER = fileURLToPath(new URL('..', import.meta.url));

function approval(): ConsumedApproval {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const s = createApprovalStore({ dir: (f) => join(dir, f) });
  return s.consume(s.propose('film1', 's2', 25).token, 'film1', 's2');
}
const args = (key?: string): AnimateImageArgs => ({ model: 'fast-h3', prompt: 'x', sourceImageUrl: 'https://a.example/i.jpg', durationSec: 5.2, aspect: '16:9', idempotencyKey: key });

describe('submitApproved', () => {
  it('reaches the client once with a matching key', async () => {
    const c = makeFakeClippy();
    const r = await submitApproved(c, approval(), args('film1:s2:1'));
    expect(r.jobId).toBeTruthy();
    expect(c.calls.filter((x) => x.tool === 'animate_image')).toHaveLength(1);
  });
  it('rejects a mismatched key before any client call', async () => {
    const c = makeFakeClippy();
    await expect(submitApproved(c, approval(), args('film1:s2:9'))).rejects.toThrow(/film1:s2:9.*film1:s2:1/);
    expect(c.calls).toHaveLength(0);
  });
  it('builds keys', () => {
    expect(idempotencyKeyFor('film 1', 's/2', 1)).toBe('film_1:s_2:1');
    expect(idempotencyKeyFor('f', 's', 1)).toBe('f:s:1:s7');
    expect(idempotencyKeyFor('x'.repeat(300), 's', 1).length).toBeLessThanOrEqual(200);
  });
});

it('the brand blocks plain objects', async () => {
  // @ts-expect-error a plain object is not a ConsumedApproval
  const plain: ConsumedApproval = { filmId: 'film1', sceneId: 's2', attempt: 1, consumedAt: 'x' };
  await expect(submitApproved(makeFakeClippy(), plain, args('film1:s2:1'))).resolves.toBeDefined(); // runtime does not check the brand; the type does
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'clippy' || name === 'node_modules' ? [] : sources(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'guard.ts' ? [full] : [];
  });
}
const offenders = () => sources(SERVER).filter((f) => /\.animateImage\s*\(/.test(readFileSync(f, 'utf8'))).map((f) => relative(SERVER, f));

describe('only guard.ts may call animateImage', () => {
  it('holds for the repository', () => expect(offenders()).toEqual([]));
  it('fails when a stray file calls it', () => {
    const stray = join(SERVER, 'generate', 'zz-stray.ts');
    mkdirSync(join(SERVER, 'generate'), { recursive: true });
    writeFileSync(stray, 'export const x = (client: any) => client.animateImage(1);\n');
    try {
      expect(offenders()).toEqual(['generate/zz-stray.ts']);
    } finally {
      rmSync(stray, { force: true });
    }
  });
});
