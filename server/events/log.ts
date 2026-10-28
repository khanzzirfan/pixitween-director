import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EventEnvelope, FilmEvent } from '@shared/events';

const logPath = (dir: string, filmId: string) => join(dir, 'films', filmId, 'events.jsonl');

const lastSeq = new Map<string, number>(); // `${dir}|${filmId}` -> last seq written
const chains = new Map<string, Promise<unknown>>(); // per-film write serialisation

/** Parse a JSONL body, skipping a truncated or corrupt final line. */
function parse(text: string): EventEnvelope[] {
  const out: EventEnvelope[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as EventEnvelope);
    } catch {
      // a half-written last line is expected after a crash
    }
  }
  return out;
}

export async function readEvents(dir: string, filmId: string, afterSeq = 0): Promise<EventEnvelope[]> {
  let text: string;
  try {
    text = await readFile(logPath(dir, filmId), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return parse(text).filter((env) => env.seq > afterSeq);
}

export function appendEvent(dir: string, filmId: string, event: FilmEvent): Promise<number> {
  const key = `${dir}|${filmId}`;
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    let seq = lastSeq.get(key);
    if (seq === undefined) seq = (await readEvents(dir, filmId)).reduce((m, e) => Math.max(m, e.seq), 0);
    seq += 1;
    const file = logPath(dir, filmId);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify({ seq, event }) + '\n');
    lastSeq.set(key, seq);
    return seq;
  });
  chains.set(key, next.catch(() => undefined));
  return next;
}
