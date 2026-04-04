CREATE TABLE IF NOT EXISTS question_banks (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  description TEXT NOT NULL DEFAULT '',
  current_revision INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS question_bank_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  import_mode TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT,
  question_count INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  UNIQUE(bank_id, revision),
  FOREIGN KEY (bank_id) REFERENCES question_banks(id)
);

CREATE INDEX IF NOT EXISTS idx_question_banks_status_name
  ON question_banks(status, name);

CREATE INDEX IF NOT EXISTS idx_question_bank_revisions_bank_revision
  ON question_bank_revisions(bank_id, revision DESC);
