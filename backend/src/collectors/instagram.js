/**
 * Instagram Reels via Apify's hashtag scraper.
 * Why: Instagram has no public search API; the Graph API hashtag endpoint
 * needs a Business account and caps at 30 hashtags / 7 days. A managed
 * scraper handles login walls, proxies and rotation for us.
 */
import { config } from '../config.js';
import { runActor } from './apify.js';

export function normalizeInstagram(item, query) {
  const isVideo = item.type === 'Video' || item.productType === 'clips' || !!item.videoUrl;
  if (!isVideo) return null;
  const code = item.shortCode || item.shortcode;
  const id = item.id || code;
  if (!id) return null;
  return {
    platform: 'instagram',
    platformId: String(id),
    groupKey: null,
    url: item.url || (code ? `https://www.instagram.com/reel/${code}/` : null),
    mediaUrl: item.videoUrl || null,
    thumbnailUrl: item.displayUrl || item.thumbnailUrl || null,
    caption: item.caption || '',
    author: item.ownerUsername || '',
    publishedAt: item.timestamp ? new Date(item.timestamp).toISOString() : null,
    stats: { views: item.videoViewCount ?? item.videoPlayCount ?? null, likes: item.likesCount ?? null },
    query,
  };
}

/**
 * @param {string[]} hashtags  without '#'
 * @param {number} depth       0 = first page; higher = deeper pagination
 */
export async function collectInstagram(hashtags, { depth = 0 } = {}) {
  const perTag = 30 * (depth + 1);
  const items = await runActor(
    config.apify.instagramActor,
    { hashtags, resultsType: 'reels', resultsLimit: perTag },
    { label: 'instagram' },
  );
  return items
    .map((i) => normalizeInstagram(i, i.inputUrl?.split('/tags/')[1]?.replace(/\/$/, '') || hashtags.join(',')))
    .filter(Boolean);
}
