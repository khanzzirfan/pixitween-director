import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { accepts, checkEngine, readSchemaVersion, SCHEMA_FILE } from './engine';

const schemaModule = (version: string, major = 1) =>
  `export const AEP_SCHEMA_VERSION = "${version}";\nexport const AEP_SCHEMA_MAJOR = ${major};\n`;
const byId = (rs: ReturnType<typeof checkEngine>) => Object.fromEntries(rs.map((r) => [r.id, r]));

it('reads the schema version out of our own schema module', () => {
  expect(readSchemaVersion(schemaModule('1.12.0'))).toEqual({ version: '1.12.0', major: 1 });
  expect(readSchemaVersion(undefined)).toBeUndefined();
  expect(readSchemaVersion('export const AEP_SCHEMA_VERSION = "1.12.0";')).toBeUndefined();
});

it('accepts a version of the same major that is not newer than the schema', () => {
  const s = { version: '1.12.0', major: 1 };
  expect(accepts(s, '1.9.0')).toBe(true);
  expect(accepts(s, '1.12.0')).toBe(true);
  expect(accepts(s, '1.13.0')).toBe(false);
  expect(accepts(s, '2.0.0')).toBe(false);
  expect(accepts(s, 'nope')).toBe(false);
});

it('passes both when the schema is versioned and the app writes a version it accepts', () => {
  const r = byId(
    checkEngine(
      makeCtx({
        [SCHEMA_FILE]: schemaModule('1.12.0'),
        'server/authoring/constants.ts': "export const AEP_VERSION = '1.9.0';\n",
      }),
    ),
  );
  expect(r['engine.schema']!.status).toBe('pass');
  expect(r['engine.schema']!.detail).toContain('1.12.0');
  expect(r['engine.written']!.status).toBe('pass');
  expect(r['engine.written']!.detail).toContain('1.9.0');
});

it('fails the schema when our own schema module does not declare a version', () => {
  const r = byId(checkEngine(makeCtx({ [SCHEMA_FILE]: 'export const nothing = 1;\n' })));
  expect(r['engine.schema']!.status).toBe('fail');
  expect(r['engine.written']!.status).toBe('fail');
});

it('fails when the app writes a version this schema does not accept', () => {
  const r = byId(
    checkEngine(
      makeCtx({
        [SCHEMA_FILE]: schemaModule('1.12.0'),
        'server/authoring/constants.ts': "export const AEP_VERSION = '2.0.0';\n",
      }),
    ),
  );
  expect(r['engine.schema']!.status).toBe('pass');
  expect(r['engine.written']!.status).toBe('fail');
  expect(r['engine.written']!.detail).toContain('2.0.0');
});

it('does not read a version out of a test file', () => {
  const r = byId(
    checkEngine(
      makeCtx({
        [SCHEMA_FILE]: schemaModule('1.12.0'),
        'server/authoring/constants.test.ts': "export const AEP_VERSION = '9.9.9';\n",
      }),
    ),
  );
  expect(r['engine.written']!.status).toBe('pass');
});
