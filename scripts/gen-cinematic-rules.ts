// Writes docs/architecture/cinematic-rules.md from the rule book (server/authoring/cinematic-rules.ts). Run after changing a rule:
//   npx tsx scripts/gen-cinematic-rules.ts
import { writeFileSync } from 'node:fs';
import { rulesMarkdown } from '../server/authoring/cinematic-rules';

writeFileSync(new URL('../docs/architecture/cinematic-rules.md', import.meta.url), rulesMarkdown() + '\n');
console.log('wrote docs/architecture/cinematic-rules.md');
