// `npm run db:export-events -- <filmId> [DATA_DIR]`: writes one film's events as JSONL to stdout, the format the report scripts read.
import { resolve } from 'node:path';
import { getDb } from '../server/db/open';

const [film, dataDir] = process.argv.slice(2);
if (!film) {
  console.error('usage: tsx scripts/db-export-events.ts <filmId> [DATA_DIR]');
  process.exit(1);
}
const rows = getDb(resolve(dataDir ?? process.env.DATA_DIR ?? './data')).prepare('SELECT seq, event_json FROM events WHERE film_id = ? ORDER BY seq').all(film) as { seq: number; event_json: string }[];
for (const r of rows) console.log(`{"seq":${r.seq},"event":${r.event_json}}`);
