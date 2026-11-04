// Owned by S10. The shape every submission check reports in.
export type Status = 'pass' | 'fail' | 'pending';

export interface CheckResult {
  id: string;
  title: string;
  status: Status;
  detail: string;
}

/** Everything a check may read, so a check is a pure function and a test hands it an in-memory repo. */
export interface PreflightCtx {
  root: string;
  /** Repo-relative paths: `git ls-files`, or a walk of the directory when git is not there. */
  tracked: string[];
  /** The file's text, or undefined when it is missing. */
  readText(path: string): string | undefined;
  sizeOf(path: string): number;
  json<T = unknown>(path: string): T | undefined;
  /** 'YYYY-MM-DD' of the first commit; undefined outside a git repository. */
  firstCommitDate?: string;
}

export type Check = (ctx: PreflightCtx) => CheckResult[];
export interface NamedCheck {
  id: string;
  run: Check;
}

export const pass = (id: string, title: string, detail = ''): CheckResult => ({ id, title, status: 'pass', detail });
export const fail = (id: string, title: string, detail: string): CheckResult => ({ id, title, status: 'fail', detail });
export const pending = (id: string, title: string, detail: string): CheckResult => ({ id, title, status: 'pending', detail });
