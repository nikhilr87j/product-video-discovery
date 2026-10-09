import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInstagram } from '../src/collectors/instagram.js';
import { normalizeMeta, adLibraryUrl } from '../src/collectors/meta.js';

test('instagram: keeps reels, drops photos', () => {
  const reel = normalizeInstagram({ id: '1', shortCode: 'Cx1', type: 'Video', videoUrl: 'https://v/1.mp4', displayUrl: 'https://i/1.jpg', caption: 'hi', ownerUsername: 'u', timestamp: '2026-09-01T00:00:00Z' }, 'tee');
  assert.equal(reel.url, 'https://www.instagram.com/reel/Cx1/');
  assert.equal(reel.thumbnailUrl, 'https://i/1.jpg');
  assert.equal(normalizeInstagram({ id: '2', type: 'Image' }, 'tee'), null);
});

test('meta: maps a video ad, keeps the collation group, drops image ads', () => {
  const ad = normalizeMeta(
    {
      ad_archive_id: '555',
      collation_id: '77',
      start_date: 1756684800,
      snapshot: { page_name: 'Brand', body: { text: 'Buy now' }, videos: [{ video_sd_url: 'https://v/sd.mp4', video_preview_image_url: 'https://i/p.jpg' }] },
    },
    'tee',
  );
  assert.equal(ad.url, 'https://www.facebook.com/ads/library/?id=555');
  assert.equal(ad.groupKey, 'meta-col:77');
  assert.equal(ad.caption, 'Buy now');
  assert.equal(ad.author, 'Brand');
  assert.equal(normalizeMeta({ ad_archive_id: '1', snapshot: { images: [{}] } }, 'x'), null);
});

test('meta: ad library URL targets active video ads in the configured country', () => {
  const u = new URL(adLibraryUrl('protein chocolate', 'IN'));
  assert.equal(u.searchParams.get('q'), 'protein chocolate');
  assert.equal(u.searchParams.get('media_type'), 'video');
  assert.equal(u.searchParams.get('country'), 'IN');
  assert.equal(u.searchParams.get('active_status'), 'active');
});
