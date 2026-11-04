import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cwd = process.cwd();
function cli(...args: string[]): { code: number | null; json: Record<string, any> } {
  const r = spawnSync('npx', ['tsx', 'engine/cli/motion.ts', ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, json: JSON.parse(r.stdout) };
}

describe('motion cli', () => {
  it('qa prints ok + groups, exit 0', () => {
    const r = cli('qa', 'engine/fixtures/basic-2d.json');
    expect(r.code).toBe(0);
    expect(r.json.ok).toBe(true);
    expect(r.json.groups).toEqual([]);
  });

  it('stale edit exits 6; edit then undo restores the doc', () => {
    const dir = mkdtempSync(join(tmpdir(), 'motion-cli-'));
    const doc = join(dir, 'd.json');
    copyFileSync(join(cwd, 'engine/fixtures/basic-2d.json'), doc);
    const before = JSON.parse(readFileSync(doc, 'utf8'));
    const ops = join(dir, 'ops.json');
    writeFileSync(ops, JSON.stringify([{ op: 'set', path: 'layers/title/alpha', value: 0.5 }]));
    const stale = cli('edit', doc, '--ops', ops, '--expect-revision', '5');
    expect(stale.code).toBe(6);
    expect(stale.json.error.code).toBe('STALE_DOC');
    expect(typeof stale.json.error.recovery).toBe('string');
    const edited = cli('edit', doc, '--ops', ops, '--expect-revision', '0');
    expect(edited.code).toBe(0);
    const undone = cli('undo', doc, '--receipt', edited.json.receipt.id, '--expect-revision', '1');
    expect(undone.code).toBe(0);
    const after = JSON.parse(readFileSync(doc, 'utf8'));
    delete after.revision;
    delete before.revision;
    expect(after).toEqual(before);
  });

  it('targets text lists props; unknown command exits 2', () => {
    expect(cli('targets', 'text').json.properties).toEqual(expect.arrayContaining(['x', 'y', 'alpha', 'rotation', 'fill']));
    expect(cli('bogus').code).toBe(2);
  });
});
