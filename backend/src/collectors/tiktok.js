/** Optional third source. Runs only when the user enables the TikTok toggle. */
import { config } from '../config.js';
import { runActor } from './apify.js';

export function normalizeTiktok(item, query) {
  if (!item.id) return null;
  return {
    platform: 'tiktok',
    platformId: String(item.id),
    groupKey: null,
    url: item.webVideoUrl || null,
    mediaUrl: item.videoUrl || item.mediaUrls?.[0] || null,
    thumbnailUrl: item.videoMeta?.coverUrl || item.covers?.[0] || null,
    caption: item.text || '',
    author: item.authorMeta?.name || '',
    publishedAt: item.createTimeISO || (item.createTime ? new Date(item.createTime * 1000).toISOString() : null),
    stats: { views: item.playCount ?? null, likes: item.diggCount ?? null },
    query,
  };
}

export async function collectTiktok(queries, { depth = 0 } = {}) {
  const items = await runActor(
    config.apify.tiktokActor,
    { searchQueries: queries, resultsPerPage: 25 * (depth + 1), searchSection: '/video' },
    { label: 'tiktok' },
  );
  return items.map((i) => normalizeTiktok(i, i.searchQuery || queries.join(', '))).filter(Boolean);
}
