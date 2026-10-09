import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY,
  input_type TEXT NOT NULL,          -- keyword | url | image
  input_value TEXT,
  product_key TEXT,
  status TEXT NOT NULL,              -- queued | running | done | failed
  product_json TEXT,
  summary_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

-- Every video we have ever shown. The uid is the canonical identity
-- (platform id, or a hash of the media URL when no id exists).
CREATE TABLE IF NOT EXISTS videos (
  uid TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_id TEXT,
  group_key TEXT,                    -- e.g. Meta collation_id: same ad under several ids
  media_hash TEXT,
  caption_hash TEXT,
  thumb_phash TEXT,
  data_json TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_group ON videos(group_key);
CREATE INDEX IF NOT EXISTS idx_videos_media ON videos(media_hash);
CREATE INDEX IF NOT EXISTS idx_videos_caption ON videos(caption_hash);

-- Which search returned which video, with the score it got for that product.
CREATE TABLE IF NOT EXISTS search_results (
  search_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  platform TEXT NOT NULL,
  score INTEGER,
  reason TEXT,
  status TEXT NOT NULL,              -- match | low | previously_seen
  query TEXT,
  rank INTEGER,
  PRIMARY KEY (search_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_results_uid ON search_results(uid);

-- Small JPEG copies of thumbnails: platform CDN links expire and block hotlinking.
CREATE TABLE IF NOT EXISTS thumbs (
  uid TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

let db;

export function getDb() {
  if (db) return db;
  const file = config.dbPath;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** For tests: swap in a fresh in-memory database. */
export function resetDbForTests() {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

export const cache = {
  get(key) {
    const row = getDb().prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key);
    if (!row) return undefined;
    if (row.expires_at < Date.now()) {
      getDb().prepare('DELETE FROM cache WHERE key = ?').run(key);
      return undefined;
    }
    return JSON.parse(row.value);
  },
  set(key, value, ttlMs) {
    getDb()
      .prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(value), Date.now() + ttlMs);
  },
};
