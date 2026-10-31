// Applies the finishing pass to a saved film composition. Usage: npx tsx scripts/finish-film.ts <in.json> <out.json> [bed src] [brief text]
import { readFileSync, writeFileSync } from 'node:fs';
import { finishComposition } from '../server/authoring/finish';

const [inFile, outFile, bed = '/cartoon/bed.wav', brief] = process.argv.slice(2);
if (!inFile || !outFile) throw new Error('usage: finish-film.ts <in.json> <out.json> [bed src]');
const c = JSON.parse(readFileSync(inFile, 'utf8'));
c.assets['music-bed'] = { type: 'audio', src: bed, duration: c.durationInFrames };
writeFileSync(outFile, JSON.stringify(finishComposition(c, { musicAssetId: 'music-bed', ...(brief ? { brief } : {}) }), null, 2));
console.log(`wrote ${outFile}`);
