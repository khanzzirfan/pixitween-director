// Owned by S10. The app owns its schema: `@shared/aep` is the contract the agents write and the engine reads, so the preflight checks that it is versioned in this repository and that the versions the app writes are ones it accepts.
import { fail, pass, type CheckResult, type PreflightCtx } from '../types';

/** Our own schema module. It declares the version every side of the app agrees on. */
export const SCHEMA_FILE = 'shared/aep/composition.ts';

export interface SchemaVersion {
  /** The semver the schema declares, for example '1.12.0'. */
  version: string;
  /** The only major this build understands. */
  major: number;
}

/** Reads the schema version out of our own schema module. */
export function readSchemaVersion(text: string | undefined): SchemaVersion | undefined {
  const version = /export const AEP_SCHEMA_VERSION = "([^"]+)"/.exec(text ?? '')?.[1];
  const major = /export const AEP_SCHEMA_MAJOR = (\d+)/.exec(text ?? '')?.[1];
  if (!version || !major) return undefined;
  return { version, major: Number(major) };
}

/** True when the schema accepts `version`: the same major, and not newer than the schema itself. */
export function accepts(schema: SchemaVersion, version: string): boolean {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) return false;
  const [maj, min, pat] = parts as [number, number, number];
  if (maj !== schema.major) return false;
  const [, smin, spat] = schema.version.split('.').map(Number) as [number, number, number];
  if (min !== smin) return min < smin;
  return pat <= spat;
}

/** The versions the app stamps on the compositions it writes, read from the server sources. */
export function writtenVersions(ctx: PreflightCtx): Array<{ file: string; version: string }> {
  const out: Array<{ file: string; version: string }> = [];
  for (const path of ctx.tracked) {
    if (!path.startsWith('server/') || !path.endsWith('.ts') || path.endsWith('.test.ts')) continue;
    const text = ctx.readText(path);
    if (!text) continue;
    for (const m of text.matchAll(/AEP_VERSION\s*=\s*'([^']+)'/g)) out.push({ file: path, version: m[1]! });
  }
  return out;
}

export function checkEngine(ctx: PreflightCtx): CheckResult[] {
  const schema = readSchemaVersion(ctx.readText(SCHEMA_FILE));
  const owned: CheckResult = schema
    ? pass('engine.schema', 'the schema is versioned in this repository', `${schema.version} (major ${schema.major})`)
    : fail('engine.schema', 'the schema is versioned in this repository', `${SCHEMA_FILE} does not declare AEP_SCHEMA_VERSION and AEP_SCHEMA_MAJOR`);

  const title = 'the versions the app writes are ones this schema accepts';
  if (!schema) return [owned, fail('engine.written', title, `the schema version is unknown: ${SCHEMA_FILE} does not declare it`)];

  const written = writtenVersions(ctx);
  const rejected = written.filter((w) => !accepts(schema, w.version));
  const compatible: CheckResult = rejected.length
    ? fail('engine.written', title, rejected.map((w) => `${w.file} writes ${w.version}`).join('; '))
    : pass('engine.written', title, [...new Set(written.map((w) => w.version))].join(', ') || 'no version is stamped');
  return [owned, compatible];
}
