/**
 * Meta Ad Library video ads via an Apify Ad Library scraper.
 * Why not the official ads_archive API: it only returns political/issue ads
 * and ads delivered in the EU/UK, so ordinary product ads running in India
 * are not available through it. The public Ad Library website shows them,
 * so we scrape the same search the website runs (active, video, by country).
 */
import { config } from '../config.js';
import { runActor } from './apify.js';

export function adLibraryUrl(query, country = config.apify.metaCountry) {
  const p = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country,
    q: query,
    media_type: 'video',
    search_type: 'keyword_unordered',
  });
  return `https://www.facebook.com/ads/library/?${p}`;
}

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

export function normalizeMeta(item, query) {
  const snap = item.snapshot || item.adSnapshot || {};
  const video = snap.videos?.[0] || snap.cards?.find((c) => c.video_hd_url || c.video_sd_url) || {};
  const mediaUrl = pick(video.video_hd_url, video.video_sd_url, video.videoHdUrl, video.videoSdUrl);
  if (!mediaUrl) return null; // image/carousel ads are out of scope
  const id = pick(item.ad_archive_id, item.adArchiveID, item.adArchiveId, item.id);
  if (!id) return null;
  const body = pick(snap.body?.text, snap.body?.markup?.__html, snap.cards?.[0]?.body, item.ad_creative_bodies?.[0], '');
  const start = pick(item.start_date, item.startDate);
  return {
    platform: 'meta',
    platformId: String(id),
    groupKey: pick(item.collation_id, item.collationID, item.collationId) ? `meta-col:${pick(item.collation_id, item.collationID, item.collationId)}` : null,
    url: `https://www.facebook.com/ads/library/?id=${id}`,
    mediaUrl,
    thumbnailUrl: pick(video.video_preview_image_url, video.videoPreviewImageUrl, snap.images?.[0]?.resized_image_url) || null,
    caption: String(body).replace(/<[^>]+>/g, ' ').trim(),
    author: pick(snap.page_name, item.page_name, item.pageName, ''),
    publishedAt: start ? new Date(typeof start === 'number' ? start * 1000 : start).toISOString() : null,
    stats: { adsInGroup: pick(item.collation_count, item.collationCount) ?? null, landingPage: snap.link_url || null },
    query,
  };
}

export async function collectMeta(queries, { depth = 0 } = {}) {
  const count = 40 * (depth + 1);
  const items = await runActor(
    config.apify.metaActor,
    {
      urls: queries.map((q) => ({ url: adLibraryUrl(q) })),
      count: count * queries.length,
      limitPerSource: count,
      'scrapePageAds.activeStatus': 'active',
      'scrapePageAds.countryCode': config.apify.metaCountry,
    },
    { label: 'meta' },
  );
  return items
    .map((i) => {
      let q = null;
      try {
        q = new URL(i.url || i.inputUrl).searchParams.get('q');
      } catch { /* not every row echoes its source URL */ }
      return normalizeMeta(i, q || queries.join(', '));
    })
    .filter(Boolean);
}
