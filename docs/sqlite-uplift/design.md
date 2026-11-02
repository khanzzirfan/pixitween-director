# SQLite uplift: design

Moves every JSON/JSONL store under `DATA_DIR` into one SQLite file, `DATA_DIR/director.db`, and moves the
showrunner's LangGraph checkpointer into the same file. Photos, rendered clips, plates and other binaries stay
as files; the database holds their metadata and path.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | Driver is the built-in `better-sqlite3` (`DatabaseSync`). Node is `>=22` (v22.21.1 here, SQLite 3.50.4). | No dependency, no native build in Docker or Fly. Prints one `ExperimentalWarning`; accepted. |
| D2 | One database file, one connection per process, opened in `server/db/open.ts`. | SQLite is a single-writer store; one connection removes lock juggling. |
| D3 | Pragmas on open: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`. | WAL gives readers and a writer at once; NORMAL is safe with WAL. |
| D4 | The API is synchronous. Store interfaces in `shared/ports.ts` stay `Promise`-returning, so stores wrap sync work in `async` functions. | Callers do not change. |
| D5 | Transactions replace the per-film promise-chain locks. Writers use `BEGIN IMMEDIATE`. | A crash mid-write rolls back; no half-written film. |
| D6 | Schema changes are numbered migrations; `PRAGMA user_version` is the version. A database newer than the code is refused. | Safe upgrades on Fly. |
| D7 | Document-shaped data (composition, brief, storyboard, event payload, job record) is stored as `TEXT` JSON next to the columns that are queried (`status`, `film_id`, `seq`, `state`). | Zod schemas keep owning the shape; SQL owns lookups. |
| D8 | The LangGraph checkpointer is our own `SqliteSaver` extending `BaseCheckpointSaver`, over `better-sqlite3`. | The official `@langchain/langgraph-checkpoint-sqlite` needs the native `better-sqlite3`. `@langchain/langgraph-checkpoint` 1.2.1 gives the base class and the serde. |
| D9 | Old files are imported once, never deleted by the importer. They stay as a backup next to the database. | Rollback is "run the old build". |
| D10 | No feature flag. The SQLite stores are the only stores. | Owner decision. |

## Schema (migration 001)

All tables are `STRICT`. Ids keep their existing regexes (`FILM_ID_RE`, `ASSET_ID_RE`, `LINEUP_ID_RE`).

```sql
CREATE TABLE films (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  head         INTEGER NOT NULL DEFAULT 0,
  max_version  INTEGER NOT NULL DEFAULT 0,
  redo_json    TEXT NOT NULL DEFAULT '[]',
  data_json    TEXT NOT NULL            -- FilmFile minus id/status/createdAt/head/maxVersion/redo
) STRICT;
CREATE INDEX films_by_status ON films (status, created_at DESC);

CREATE TABLE film_versions (
  film_id          TEXT NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  parent           INTEGER,
  source           TEXT NOT NULL,
  note             TEXT,
  at               TEXT NOT NULL,
  composition_json TEXT NOT NULL,
  PRIMARY KEY (film_id, version)
) STRICT, WITHOUT ROWID;

CREATE TABLE events (
  film_id    TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  at         TEXT NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (film_id, seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE ledger (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id  TEXT NOT NULL,
  at       TEXT NOT NULL,
  model    TEXT NOT NULL,
  units    TEXT NOT NULL,               -- JSON: a number or a note
  usd      REAL NOT NULL DEFAULT 0,
  credits  REAL NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX ledger_by_film ON ledger (film_id);

CREATE TABLE assets (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  file       TEXT NOT NULL,             -- path relative to DATA_DIR/assets
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  meta_json  TEXT NOT NULL              -- the rest of AssetRef (role, width, height, ...)
) STRICT;

CREATE TABLE lineups (
  id         TEXT PRIMARY KEY,
  aspect     TEXT NOT NULL,
  brief      TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE lineup_items (
  lineup_id    TEXT NOT NULL REFERENCES lineups(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  product_json TEXT NOT NULL,
  film_id      TEXT,
  state        TEXT NOT NULL,           -- waiting | making | done | failed
  error        TEXT,
  PRIMARY KEY (lineup_id, position)
) STRICT, WITHOUT ROWID;
CREATE INDEX lineup_items_by_state ON lineup_items (state);

CREATE TABLE crew_board     (film_id TEXT PRIMARY KEY, jobs_json TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
CREATE TABLE crew_snapshots (film_id TEXT NOT NULL, job_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
                             PRIMARY KEY (film_id, job_id)) STRICT, WITHOUT ROWID;

CREATE TABLE generate_jobs (
  film_id TEXT NOT NULL, scene_id TEXT NOT NULL, status TEXT NOT NULL, record_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (film_id, scene_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX generate_jobs_by_status ON generate_jobs (status);
CREATE TABLE approvals (film_id TEXT PRIMARY KEY, entries_json TEXT NOT NULL) STRICT;

CREATE TABLE lg_checkpoints (
  thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '', checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT, type TEXT NOT NULL, checkpoint BLOB NOT NULL, metadata BLOB NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
) STRICT, WITHOUT ROWID;
CREATE TABLE lg_writes (
  thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL DEFAULT '', checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL, idx INTEGER NOT NULL, channel TEXT NOT NULL, type TEXT NOT NULL, value BLOB NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
) STRICT, WITHOUT ROWID;

CREATE TABLE import_log (source TEXT PRIMARY KEY, imported_at TEXT NOT NULL, rows_json TEXT NOT NULL) STRICT;
```

Event `seq` per film is gapless and starts at 1: insert with
`SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE film_id = ?` inside one `BEGIN IMMEDIATE`. Replay is
`WHERE film_id = ? AND seq > ? ORDER BY seq`.

## LangGraph `SqliteSaver`

Extends `BaseCheckpointSaver` from `@langchain/langgraph-checkpoint`. It implements `getTuple`, `list`, `put`,
`putWrites` and `deleteThread` over `lg_checkpoints` / `lg_writes`, serialising with `this.serde.dumpsTyped` and
`loadsTyped` (so `Uint8Array` values need no base64 hack). The thread id stays the film id. A differential test
runs the same operations on `MemorySaver` and `SqliteSaver` and compares results, including `list` filters
(`before`, `limit`, `filter`) and the special write channels.

## Line-up resume

`server/lineup/runner.ts` owns the loop that now lives inside `POST /api/lineups`. On boot,
`resumeLineups(deps)` finds line-ups with an item in `waiting` or `making` and continues in order. A `making`
item re-enters `runCrew(filmId)`, which resumes from that film's `lg_checkpoints`. The "stopped: the server
restarted" failure message goes away.

## What stays on disk

`DATA_DIR/assets/*.{png,jpg,webp,mp4,webm,wav,mp3}`, generated plates and clips under `DATA_DIR/films/<id>/generate/`
(bytes only), export temp dirs. Everything else moves.

## Rollback

Legacy files are untouched by the import. To go back: check out the previous build and point it at the same
`DATA_DIR`. Data written after the cut-over lives only in `director.db`; `npm run db:export-events <filmId>`
writes an `events.jsonl` for the report scripts.
