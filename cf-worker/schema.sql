PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chat_uploads (
  id TEXT PRIMARY KEY,
  source_label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone_number TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (upload_id) REFERENCES chat_uploads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_stats (
  member_id TEXT PRIMARY KEY,
  messages INTEGER NOT NULL,
  words INTEGER NOT NULL,
  media INTEGER NOT NULL,
  links INTEGER NOT NULL,
  active_days INTEGER NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_signals (
  member_id TEXT PRIMARY KEY,
  answer_like INTEGER NOT NULL,
  reply_helpfulness INTEGER NOT NULL,
  long_msgs INTEGER NOT NULL,
  unique_words INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_analysis (
  member_id TEXT PRIMARY KEY,
  value_score REAL NOT NULL,
  role TEXT NOT NULL,
  vibe TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_badges (
  member_id TEXT NOT NULL,
  badge TEXT NOT NULL,
  PRIMARY KEY (member_id, badge),
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_samples (
  member_id TEXT PRIMARY KEY,
  samples_json TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
