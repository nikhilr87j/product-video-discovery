/**
 * De-duplication across and within searches.
 *
 * A video is a duplicate of something already indexed when ANY of:
 *  1. same uid               (platform + platform id, or hash of media URL)
 *  2. same group key         (Meta collation_id = one ad under several ids)
 *  3. same media hash        (same file reachable via different URLs / ids)
 *  4. thumbnail dHash within `maxDistance` bits (reposts, re-uploads, re-encodes)
 *  5. same caption hash AND same author AND dHash within 1.5×maxDistance
 *     (the same ad relaunched with a fresh id and slightly different crop)
 *
 * Caption alone never merges two videos: advertisers reuse the same copy on
 * genuinely different creatives.
 */
import { sha1, normalizeText, canonicalMediaUrl } from '../lib/util.js';
import { hamming } from './thumbs.js';

export function videoUid(v) {
  if (v.platformId) return `${v.platform}:${v.platformId}`;
  return `${v.platform}:m:${sha1(canonicalMediaUrl(v.mediaUrl || v.url || v.thumbnailUrl || ''))}`;
}

export function signatures(v) {
  const caption = normalizeText(v.caption);
  return {
    uid: v.uid || videoUid(v),
    groupKey: v.groupKey || null,
    mediaHash: v.mediaUrl ? sha1(canonicalMediaUrl(v.mediaUrl)) : null,
    captionHash: caption.length >= 25 ? sha1(caption) : null,
    author: (v.author || '').toLowerCase() || null,
    phash: v.phash || null,
  };
}

export class DedupIndex {
  constructor({ maxDistance = 6 } = {}) {
    this.maxDistance = maxDistance;
    this.uids = new Map();
    this.groups = new Map();
    this.media = new Map();
    this.captions = new Map(); // captionHash -> [{author, phash, uid}]
    this.phashes = [];         // [{phash, uid}]
  }

  /** @returns {{uid: string, rule: string} | null} what it duplicates, if anything */
  find(sig) {
    if (this.uids.has(sig.uid)) return { uid: sig.uid, rule: 'same id' };
    if (sig.groupKey && this.groups.has(sig.groupKey)) return { uid: this.groups.get(sig.groupKey), rule: 'same ad group' };
    if (sig.mediaHash && this.media.has(sig.mediaHash)) return { uid: this.media.get(sig.mediaHash), rule: 'same media file' };
    if (sig.phash) {
      for (const p of this.phashes) {
        if (hamming(sig.phash, p.phash) <= this.maxDistance) return { uid: p.uid, rule: 'near-identical thumbnail' };
      }
    }
    if (sig.captionHash && this.captions.has(sig.captionHash)) {
      for (const c of this.captions.get(sig.captionHash)) {
        const close = !sig.phash || !c.phash || hamming(sig.phash, c.phash) <= Math.round(this.maxDistance * 1.5);
        if (c.author && c.author === sig.author && close) return { uid: c.uid, rule: 'same caption, author and similar frame' };
      }
    }
    return null;
  }

  add(sig) {
    this.uids.set(sig.uid, sig.uid);
    if (sig.groupKey) this.groups.set(sig.groupKey, sig.uid);
    if (sig.mediaHash) this.media.set(sig.mediaHash, sig.uid);
    if (sig.phash) this.phashes.push({ phash: sig.phash, uid: sig.uid });
    if (sig.captionHash) {
      if (!this.captions.has(sig.captionHash)) this.captions.set(sig.captionHash, []);
      this.captions.get(sig.captionHash).push({ author: sig.author, phash: sig.phash, uid: sig.uid });
    }
  }

  get size() {
    return this.uids.size;
  }
}

/**
 * Split candidates into fresh / duplicate-within-this-search / seen-before.
 * Fresh items are added to `current` so later rounds dedupe against them.
 */
export function partition(candidates, { history, current }) {
  const fresh = [];
  const within = [];
  const previouslySeen = [];
  for (const v of candidates) {
    const sig = signatures(v);
    v.uid = sig.uid;
    const dupNow = current.find(sig);
    if (dupNow) {
      within.push({ video: v, ...dupNow });
      continue;
    }
    const dupBefore = history.find(sig);
    if (dupBefore) {
      // Remember it so we don't re-report it within this search either.
      current.add(sig);
      previouslySeen.push({ video: v, ...dupBefore });
      continue;
    }
    current.add(sig);
    fresh.push(v);
  }
  return { fresh, within, previouslySeen };
}
