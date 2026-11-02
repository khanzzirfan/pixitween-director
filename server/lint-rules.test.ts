import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint();
const lint = async (code: string, filePath: string) => (await eslint.lintText(code, { filePath }))[0]!.messages;
const restricted = (m: Awaited<ReturnType<typeof lint>>) => m.filter((x) => x.ruleId === '@typescript-eslint/no-restricted-imports');

interface Fence {
  /** The specifier the fence names. A `group` ending in `/*` becomes `<prefix>/sub`. */
  name: string;
  allowTypeImports: boolean;
}

/**
 * Every package the fence names for a file, read out of the effective eslint config.
 * The fence is the config's business, so the test never has to name a package itself.
 */
const fenced = async (filePath: string): Promise<Fence[]> => {
  const cfg = await eslint.calculateConfigForFile(filePath);
  const rule = cfg.rules['@typescript-eslint/no-restricted-imports'] as unknown as
    | [string, { paths?: { name: string; allowTypeImports?: boolean }[]; patterns?: { group: string[]; allowTypeImports?: boolean }[] }]
    | undefined;
  const options = rule?.[1] ?? {};
  const paths = (options.paths ?? []).map((p) => ({ name: p.name, allowTypeImports: p.allowTypeImports === true }));
  const groups = (options.patterns ?? []).flatMap((p) =>
    p.group.map((g) => ({ name: g.endsWith('/*') ? `${g.slice(0, -2)}/sub` : g, allowTypeImports: p.allowTypeImports === true })),
  );
  return [...paths, ...groups];
};

const valueImport = (name: string) => `import { a } from '${name}';\nexport const b = a;\n`;
const typeImport = (name: string) => `import type { A } from '${name}';\nexport type B = A;\n`;

it('rejects a value import of every package the fence names in server/', async () => {
  const fences = await fenced('server/x.ts');
  expect(fences.length).toBeGreaterThan(0);
  for (const f of fences) {
    expect(restricted(await lint(valueImport(f.name), 'server/x.ts')), f.name).not.toHaveLength(0);
  }
});

it('allows a type import only where the fence lets a package be imported as a type', async () => {
  for (const f of await fenced('server/x.ts')) {
    const m = restricted(await lint(typeImport(f.name), 'server/x.ts'));
    expect(m.length, f.name).toBe(f.allowTypeImports ? 0 : 1);
  }
});

it('fences in web/ exactly what the web config names', async () => {
  const webFences = new Set((await fenced('web/src/x.ts')).map((f) => f.name));
  for (const f of await fenced('server/x.ts')) {
    const m = restricted(await lint(valueImport(f.name), 'web/src/x.ts'));
    expect(m.length, f.name).toBe(webFences.has(f.name) ? 1 : 0);
  }
});

it('fences the dropped packages in every area of the repo', async () => {
  // web/ carries the repo-wide fence untouched, so it names every dropped package.
  const dropped = await fenced('web/src/x.ts');
  expect(dropped.length).toBeGreaterThan(0);
  for (const area of ['web/src/x.ts', 'server/x.ts', 'shared/x.ts', 'scripts/x.ts', 'engine/src/x.ts']) {
    for (const f of dropped) {
      expect(restricted(await lint(valueImport(f.name), area)), `${area} ${f.name}`).not.toHaveLength(0);
    }
  }
});

it('keeps the shared schema a type-only contract on the server', async () => {
  const m = await lint(valueImport('@shared/aep'), 'server/x.ts');
  expect(restricted(m)).toHaveLength(1);
  expect(restricted(await lint(typeImport('@shared/aep'), 'server/x.ts'))).toHaveLength(0);
  expect(restricted(await lint(valueImport('@shared/aep'), 'web/src/x.ts'))).toHaveLength(0);
});
