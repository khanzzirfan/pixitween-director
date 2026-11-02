// Owned by S10. The only impure file of the preflight: it reads the real folder and asks git.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PreflightCtx } from './types';

export interface ContextOptions {
  /** Tracked files, or undefined when there is no git. Injected in tests. */
  gitLsFiles?: (root: string) => string[] | undefined;
  /** The first commit's date as YYYY-MM-DD, or undefined. */
  gitFirstCommit?: (root: string) => string | undefined;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return undefined;
  }
}

const defaultLsFiles = (root: string): string[] | undefined => {
  // tracked files plus new ones git does not ignore, so the pack can be checked before it is committed
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return out === undefined ? undefined : out.split('\0').filter(Boolean);
};
const defaultFirstCommit = (root: string): string | undefined => {
  const out = git(root, ['log', '--reverse', '--format=%aI']);
  const first = out?.split('\n').find(Boolean);
  return first ? first.slice(0, 10) : undefined;
};

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}

export function buildContext(root: string, o: ContextOptions = {}): PreflightCtx {
  const tracked = ((o.gitLsFiles ?? defaultLsFiles)(root) ?? walk(root)).filter((p) => existsSync(join(root, p)));
  const firstCommitDate = (o.gitFirstCommit ?? defaultFirstCommit)(root);
  const readText = (p: string): string | undefined => {
    try {
      return readFileSync(join(root, p), 'utf8');
    } catch {
      return undefined;
    }
  };
  return {
    root,
    tracked,
    readText,
    sizeOf: (p) => {
      try {
        return statSync(join(root, p)).size;
      } catch {
        return 0;
      }
    },
    json: <T,>(p: string) => {
      const t = readText(p);
      if (t === undefined) return undefined;
      try {
        return JSON.parse(t) as T;
      } catch {
        return undefined;
      }
    },
    ...(firstCommitDate ? { firstCommitDate } : {}),
  };
}
