// Numbered migrations; PRAGMA user_version is the applied count. Never edit a shipped migration, add the next one.
export const MIGRATIONS: readonly string[] = [
  `
CREATE TABLE films (
  id           TEXT PRIMARY KEY,
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  head         INTEGER NOT NULL DEFAULT 0,
  max_version  INTEGER NOT NULL DEFAULT 0,
  redo_json    TEXT NOT NULL DEFAULT '[]',
  data_json    TEXT NOT NULL
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
  units    TEXT NOT NULL,
  usd      REAL NOT NULL DEFAULT 0,
  credits  REAL NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX ledger_by_film ON ledger (film_id);

CREATE TABLE assets (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  file       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  meta_json  TEXT NOT NULL
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
  state        TEXT NOT NULL,
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
  task_id TEXT NOT NULL, idx INTEGER NOT NULL, task_path TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL, type TEXT NOT NULL, value BLOB NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
) STRICT, WITHOUT ROWID;

CREATE TABLE import_log (source TEXT PRIMARY KEY, imported_at TEXT NOT NULL, rows_json TEXT NOT NULL) STRICT;
`,
  // 2: the learned corpus. Entries are craft lessons (seeded from the reference deck, editable); outcomes say how each film that used them ended.
  `
CREATE TABLE corpus_entries (
  id         TEXT PRIMARY KEY,
  topic      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '*',
  text       TEXT NOT NULL,
  source     TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX corpus_by_category ON corpus_entries (category, weight DESC);

CREATE TABLE film_outcomes (
  film_id        TEXT PRIMARY KEY,
  category       TEXT NOT NULL,
  entry_ids_json TEXT NOT NULL,
  status         TEXT NOT NULL,
  cost_usd       REAL NOT NULL DEFAULT 0,
  at             TEXT NOT NULL
) STRICT;
`,
  // 3: a lesson is for the retail clip, the cinematic film, or both. The seeded rows are dropped so they come back tagged (ids are stable hashes).
  `
ALTER TABLE corpus_entries ADD COLUMN scope TEXT NOT NULL DEFAULT 'all';
DELETE FROM corpus_entries WHERE source = 'reference-deck' OR source LIKE '%.md';
`,
  // 4: reference films, measured per shot from frames (25 fps). The lessons in corpus_entries are derived from these rows and can be rebuilt.
  `
CREATE TABLE corpus_films (
  slug          TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  fps           REAL NOT NULL,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  duration_s    REAL NOT NULL,
  frames        INTEGER NOT NULL,
  shots         INTEGER NOT NULL,
  avg_shot_s    REAL NOT NULL,
  median_shot_s REAL NOT NULL,
  cuts_per_10s  REAL NOT NULL,
  hold_s        REAL NOT NULL,
  hold_ratio    REAL NOT NULL,
  kind          TEXT NOT NULL DEFAULT '',
  summary       TEXT NOT NULL DEFAULT '',
  arc_json      TEXT NOT NULL DEFAULT '{}',
  review_json   TEXT,
  ingested_at   TEXT NOT NULL
) STRICT;

CREATE TABLE corpus_shots (
  film_slug    TEXT NOT NULL REFERENCES corpus_films (slug) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  start_s      REAL NOT NULL,
  end_s        REAL NOT NULL,
  dur_s        REAL NOT NULL,
  enters_via   TEXT NOT NULL,
  move         TEXT NOT NULL,
  ease         TEXT NOT NULL,
  zoom_pct     REAL NOT NULL,
  pan_pct      REAL NOT NULL,
  tilt_pct     REAL NOT NULL,
  jitter       REAL NOT NULL,
  luma         REAL NOT NULL,
  contrast     REAL NOT NULL,
  saturation   REAL NOT NULL,
  warmth       REAL NOT NULL,
  key_style    TEXT NOT NULL,
  temperature  TEXT NOT NULL,
  hue          TEXT NOT NULL,
  dof_ratio    REAL NOT NULL,
  scale        TEXT,
  beat         TEXT,
  note         TEXT,
  PRIMARY KEY (film_slug, idx)
) STRICT, WITHOUT ROWID;
CREATE INDEX corpus_shots_by_move ON corpus_shots (move);
`,
];
