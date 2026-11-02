// `npm run corpus:films -- [MOVIES_DIR] [DATA_DIR]`: snapshot the analysed reference films (debug/movies, 25 fps) into docs/direction/corpus/films,
// then load them and the lessons derived from them into director.db. Re-run after analysing or reviewing more films.
import { resolve } from 'node:path';
import { getDb } from '../server/db/open';
import { FILMS_DIR, ingestAllFilms, writeSnapshots } from '../server/corpus/films';

const movies = resolve(process.argv[2] ?? 'debug/movies');
const db = getDb(resolve(process.argv[3] ?? process.env.DATA_DIR ?? './data'));
const slugs = writeSnapshots(movies);
console.log(`${slugs.length} film snapshots written to ${FILMS_DIR}`);
const r = ingestAllFilms(db);
console.log(`${r.films} films in director.db, ${r.lessons} lessons derived`);
