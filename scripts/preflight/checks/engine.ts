// Owned by S10. The engine is a package from the npm registry, pinned by the lockfile: that is what makes "the engine is pre-existing and we did not copy it" checkable.
import { fail, pass, type CheckResult, type PreflightCtx } from '../types';

export const ENGINE = 'reacthub-pixitweenjs';

/** A version range or dist-tag from the registry, not a path, a git URL or a link. */
export function isRegistrySpec(spec: string): boolean {
  const s = spec.trim();
  if (!s) return false;
  if (/^(file|link|git|github|gitlab|bitbucket|http|https|ssh|workspace|portal):/i.test(s) || /^(\.{0,2}\/|~\/)/.test(s) || s.includes('/')) return false;
  return /^[\^~<>=v\d]/.test(s) || /^[a-z][a-z0-9-]*$/i.test(s);
}

interface Pkg {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
interface Lock {
  packages?: Record<string, { version?: string; resolved?: string; integrity?: string }>;
}

export function checkEngine(ctx: PreflightCtx): CheckResult[] {
  const pkg = ctx.json<Pkg>('package.json');
  const lock = ctx.json<Lock>('package-lock.json');
  const spec = pkg?.dependencies?.[ENGINE] ?? pkg?.devDependencies?.[ENGINE];
  const dep: CheckResult =
    spec === undefined
      ? fail('engine.dependency', 'the engine is an npm dependency', `package.json does not depend on ${ENGINE}`)
      : isRegistrySpec(spec)
        ? pass('engine.dependency', 'the engine is an npm dependency', `${ENGINE}@${spec}`)
        : fail('engine.dependency', 'the engine is an npm dependency', `${ENGINE} is '${spec}', not a registry version: install it from npm`);

  const entry = lock?.packages?.[`node_modules/${ENGINE}`];
  let locked: CheckResult;
  if (!lock) locked = fail('engine.lockfile', 'the lockfile pins the engine', 'package-lock.json is missing: run npm install');
  else if (!entry) locked = fail('engine.lockfile', 'the lockfile pins the engine', `${ENGINE} is not in package-lock.json: run npm install`);
  else if (!entry.version || !entry.resolved?.startsWith('https://registry.npmjs.org/') || !entry.integrity)
    locked = fail('engine.lockfile', 'the lockfile pins the engine', `the lock entry for ${ENGINE} needs a version, a registry 'resolved' and an 'integrity': re-run npm install ${ENGINE}@alpha`);
  else locked = pass('engine.lockfile', 'the lockfile pins the engine', `${entry.version}`);
  return [dep, locked];
}
