// `npm run corpus:report -- [DATA_DIR]`: which craft lessons were shown to how many films, how many ended ready, at what average cost.
import { resolve } from 'node:path';
import { outcomeReport, seedCorpus } from '../server/corpus/store';
import { getDb } from '../server/db/open';

const db = getDb(resolve(process.argv[2] ?? process.env.DATA_DIR ?? './data'));
seedCorpus(db);
for (const r of outcomeReport(db))
  console.log(`${r.films} films, ${r.ready} ready, $${r.avgCostUsd.toFixed(2)} avg, weight ${r.weight}  ${r.id}  ${r.text.slice(0, 80)}`);
