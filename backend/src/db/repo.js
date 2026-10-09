import { getDb } from './index.js';
import { DedupIndex, signatures } from '../services/dedup.js';

const json = (s) => (s ? JSON.parse(s) : null);

export function createSearch({ id, inputType, inputValue }) {
  getDb()
    .prepare('INSERT INTO searches (id, input_type, input_value, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, inputType, inputValue ?? null, 'queued', Date.now());
}

export function updateSearch(id, fields) {
  const map = { status: 'status', product: 'product_json', summary: 'summary_json', error: 'error', finishedAt: 'finished_at', productKey: 'product_key' };
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!map[k]) continue;
    sets.push(`${map[k]} = ?`);
    vals.push(k === 'product' || k === 'summary' ? JSON.stringify(v) : v);
  }
  if (sets.length) getDb().prepare(`UPDATE searches SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

/** Strip transient / heavy fields before persisting a video. */
function publicVideo(v) {
  const { thumb, mock, phash, ...rest } = v; // eslint-disable-line no-unused-vars
  return rest;
}

export function saveResults(searchId, rows) {
  const db = getDb();
  const upsertVideo = db.prepare(`INSERT INTO videos (uid, platform, platform_id, group_key, media_hash, caption_hash, thumb_phash, data_json, first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid) DO NOTHING`);
  const insertResult = db.prepare(`INSERT OR REPLACE INTO search_results (search_id, uid, platform, score, reason, status, query, rank)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    rows.forEach((r, i) => {
      const v = r.video;
      const sig = signatures(v);
      upsertVideo.run(sig.uid, v.platform, v.platformId ?? null, sig.groupKey, sig.mediaHash, sig.captionHash, sig.phash, JSON.stringify(publicVideo(v)), Date.now());
      insertResult.run(searchId, sig.uid, v.platform, r.score ?? null, r.reason ?? null, r.status, v.query ?? null, i);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Everything ever shown, as a dedup index (used to keep new searches fresh). */
export function loadHistoryIndex(maxDistance) {
  const idx = new DedupIndex({ maxDistance });
  const rows = getDb().prepare('SELECT uid, group_key, media_hash, caption_hash, thumb_phash, data_json FROM videos').all();
  for (const r of rows) {
    const data = json(r.data_json) || {};
    idx.add({ uid: r.uid, groupKey: r.group_key, mediaHash: r.media_hash, captionHash: r.caption_hash, phash: r.thumb_phash, author: (data.author || '').toLowerCase() || null });
  }
  return idx;
}

export function getVideo(uid) {
  const r = getDb().prepare('SELECT data_json FROM videos WHERE uid = ?').get(uid);
  return r ? json(r.data_json) : null;
}

export function getSearch(id) {
  const s = getDb().prepare('SELECT * FROM searches WHERE id = ?').get(id);
  if (!s) return null;
  const rows = getDb()
    .prepare(`SELECT r.uid, r.platform, r.score, r.reason, r.status, r.query, r.rank, v.data_json, v.first_seen_at
              FROM search_results r LEFT JOIN videos v ON v.uid = r.uid WHERE r.search_id = ? ORDER BY r.rank`)
    .all(id);
  return {
    id: s.id,
    inputType: s.input_type,
    inputValue: s.input_value,
    status: s.status,
    product: json(s.product_json),
    summary: json(s.summary_json),
    error: s.error,
    createdAt: s.created_at,
    finishedAt: s.finished_at,
    results: rows.map((r) => ({
      ...(json(r.data_json) || {}),
      uid: r.uid,
      platform: r.platform,
      score: r.score,
      reason: r.reason,
      status: r.status,
      query: r.query,
      firstSeenAt: r.first_seen_at,
    })),
  };
}

export function listHistory(limit = 50) {
  return getDb()
    .prepare(`SELECT s.id, s.input_type, s.input_value, s.status, s.created_at, s.summary_json, s.product_json,
                (SELECT COUNT(*) FROM search_results r WHERE r.search_id = s.id AND r.status = 'match') AS matches
              FROM searches s ORDER BY s.created_at DESC LIMIT ?`)
    .all(limit)
    .map((s) => {
      const product = json(s.product_json);
      return {
        id: s.id,
        inputType: s.input_type,
        inputValue: s.input_value,
        status: s.status,
        createdAt: s.created_at,
        title: product?.title || s.input_value,
        imageUrl: product?.imageUrl || null,
        counts: json(s.summary_json)?.counts || null,
        matches: s.matches,
      };
    });
}

/** The score this exact video got the last time it was shown. */
export function lastResultFor(uid) {
  return getDb().prepare('SELECT score, reason, search_id FROM search_results WHERE uid = ? AND status != ? ORDER BY rowid DESC LIMIT 1').get(uid, 'previously_seen');
}

export function saveThumb(uid, thumb) {
  if (!thumb) return;
  getDb().prepare('INSERT OR IGNORE INTO thumbs (uid, mime, data) VALUES (?, ?, ?)').run(uid, thumb.mime, Buffer.from(thumb.base64, 'base64'));
}

export function getThumb(uid) {
  return getDb().prepare('SELECT mime, data FROM thumbs WHERE uid = ?').get(uid);
}

export function hasThumb(uid) {
  return !!getDb().prepare('SELECT 1 FROM thumbs WHERE uid = ?').get(uid);
}
