// `npm run db:import -- [DATA_DIR]`: imports the old files under DATA_DIR into DATA_DIR/director.db (the server also does this on boot).
import { resolve } from 'node:path';
import { importLegacyData } from '../server/db/import-legacy';

const dir = resolve(process.argv[2] ?? process.env.DATA_DIR ?? './data');
console.log(`importing ${dir} ->  ${dir}/director.db`);
console.log(JSON.stringify(importLegacyData(dir), null, 2));
