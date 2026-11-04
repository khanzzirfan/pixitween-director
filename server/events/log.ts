import type { EventEnvelope, FilmEvent } from '@shared/events';
import { getDb, tx } from '../db/open';

export async function readEvents(dir: string, filmId: string, afterSeq = 0): Promise<EventEnvelope[]> {
  const rows = getDb(dir).prepare('SELECT seq, event_json FROM events WHERE film_id = ? AND seq > ? ORDER BY seq').all(filmId, afterSeq) as {
    seq: number;
    event_json: string;
  }[];
  return rows.map((r) => ({
    seq: r.seq,
    event: JSON.parse(r.event_json) as FilmEvent,
  }));
}

/** Append one event; seq is gapless per film, assigned inside one transaction. */
export async function appendEvent(dir: string, filmId: string, event: FilmEvent): Promise<number> {
  const db = getDb(dir);
  return tx(db, () => {
    const { n } = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM events WHERE film_id = ?').get(filmId) as { n: number };
    db.prepare('INSERT INTO events (film_id, seq, type, at, event_json) VALUES (?, ?, ?, ?, ?)').run(
      filmId,
      n,
      event.type,
      new Date().toISOString(),
      JSON.stringify(event),
    );
    return n;
  });
}
