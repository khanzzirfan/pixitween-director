import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint();
const lint = async (code: string, filePath: string) => (await eslint.lintText(code, { filePath }))[0]!.messages;

it('rejects a value import of the engine in server/', async () => {
  const m = await lint("import { parseAepComposition } from 'reacthub-pixitweenjs';\nexport const a = parseAepComposition;\n", 'server/x.ts');
  const errs = m.filter((x) => x.ruleId === '@typescript-eslint/no-restricted-imports');
  expect(errs).toHaveLength(1);
});

it('allows a type import of the engine in server/', async () => {
  const m = await lint("import type { AepCompositionJson } from 'reacthub-pixitweenjs';\nexport type A = AepCompositionJson;\n", 'server/x.ts');
  expect(m.filter((x) => x.ruleId === '@typescript-eslint/no-restricted-imports')).toHaveLength(0);
});

it('allows a value import of the engine in web/', async () => {
  const m = await lint("import { parseAepComposition } from 'reacthub-pixitweenjs';\nexport const a = parseAepComposition;\n", 'web/src/x.ts');
  expect(m.filter((x) => x.ruleId === '@typescript-eslint/no-restricted-imports')).toHaveLength(0);
});
