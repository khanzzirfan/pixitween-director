import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Env } from '../../server/env';
import { loadEnv } from '../../server/env';

export interface LiveScript {
  describe(): string;
  estimateUsd(): number;
  run(ctx: { env: Env; log(line: string): void }): Promise<void>;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** `npm run live -- <name> [--yes]`: always prints the description and the estimate; runs only with --yes. Returns the exit code. */
export async function runLive(argv: string[], o: { dir?: string; log?: (l: string) => void } = {}): Promise<number> {
  const dir = o.dir ?? HERE;
  const log = o.log ?? ((l: string) => console.log(l));
  const name = argv.find((a) => !a.startsWith('--'));
  const yes = argv.includes('--yes');
  const available = () =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'run.ts')
      .map((f) => f.slice(0, -3))
      .sort();

  const file = name && /^[\w-]+$/.test(name) ? join(dir, `${name}.ts`) : undefined;
  if (!file || !existsSync(file)) {
    log(name ? `Unknown live script '${name}'.` : 'Usage: npm run live -- <name> [--yes]');
    log(`Available: ${available().join(', ') || '(none)'}`);
    return 2;
  }

  const script = (await import(pathToFileURL(file).href)) as LiveScript;
  log(script.describe());
  log(`estimated cost: $${script.estimateUsd()}`);
  if (!yes) {
    log('Dry run. Pass --yes to run.');
    return 0;
  }
  await script.run({ env: loadEnv(), log });
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // loadEnvFile never overrides a variable that is already set, so .env.dev wins over .env
  for (const file of ['.env.dev', '.env']) if (existsSync(file)) process.loadEnvFile(file);
  runLive(process.argv.slice(2)).then(
    (code) => void (process.exitCode = code),
    (e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
