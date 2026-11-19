-- Cloudflare D1 schema for the Affix Splitter
-- Apply with: npx wrangler d1 execute affix-db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS words (
  word        TEXT PRIMARY KEY,           -- normalized lowercase word
  status      TEXT NOT NULL,              -- 'ok' | 'not_a_word'
  difficulty  TEXT,                       -- 'easy' | 'medium' | 'hard'  (하/중/상)
  data        TEXT NOT NULL,              -- full JSON result from Claude
  hits        INTEGER NOT NULL DEFAULT 0, -- how many times served from cache
  review      TEXT,                       -- NULL | 'ok' | 'wrong' (instructor sample check)
  review_note TEXT,
  created_at  TEXT NOT NULL
);

-- One row per student lookup. `student` is a salted hash, never an email.
CREATE TABLE IF NOT EXISTS usage_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student    TEXT NOT NULL,
  word       TEXT NOT NULL,
  day        TEXT NOT NULL,               -- YYYY-MM-DD (UTC+9 school day)
  cached     INTEGER NOT NULL,            -- 1 = served from cache, 0 = Claude call
  guess      TEXT,                        -- student's guess (after reveal)
  rating     TEXT,                        -- 'right' | 'close' | 'off' self-rating
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_student_day ON usage_log (student, day);

-- One row per real Claude API call, used for the budget guard.
CREATE TABLE IF NOT EXISTS api_calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  word       TEXT NOT NULL,
  in_tokens  INTEGER NOT NULL,
  out_tokens INTEGER NOT NULL,
  cost_usd   REAL NOT NULL,
  created_at TEXT NOT NULL
);
