/**
 * Thumbnail loading + perceptual hashing.
 * One download per thumbnail feeds both the near-duplicate check (dHash)
 * and the vision model (small JPEG).
 */
import sharp from 'sharp';
import { safeFetch } from '../lib/safeFetch.js';
import { mapLimit } from '../lib/util.js';
import { logger } from '../lib/logger.js';

const DATA_URI = /^data:(image\/(?:svg\+xml|png|jpeg|webp));base64,([a-z0-9+/=]+)$/i;

async function fetchBytes(url) {
  const m = url.match(DATA_URI);
  if (m) return Buffer.from(m[2], 'base64');
  const res = await safeFetch(url, { accept: 'image/*', maxBytes: 4_000_000, timeoutMs: 10000 });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.body;
}

/** 64-bit difference hash, hex encoded. Robust to re-encoding and resizing. */
export async function dHash(buffer) {
  const px = await sharp(buffer, { failOn: 'none' }).flatten({ background: '#fff' }).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits = (bits << 1n) | (px[row * 9 + col] > px[row * 9 + col + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a, b) {
  if (!a || !b) return 64;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Adds `thumb` ({mime, base64}) and `phash` to each video in place.
 * Failures leave both null; the video is kept and scored on caption only.
 */
export async function loadThumbs(videos, { concurrency = 8 } = {}) {
  let failed = 0;
  await mapLimit(videos, concurrency, async (v) => {
    if (v.thumb !== undefined) return;
    v.thumb = null;
    v.phash = null;
    if (!v.thumbnailUrl) return;
    try {
      const buf = await fetchBytes(v.thumbnailUrl);
      v.phash = await dHash(buf);
      const jpeg = await sharp(buf, { failOn: 'none' }).flatten({ background: '#fff' }).resize(384, 384, { fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
      v.thumb = { mime: 'image/jpeg', base64: jpeg.toString('base64') };
    } catch (err) {
      failed++;
      logger.debug({ err: err.message, url: v.thumbnailUrl.slice(0, 80) }, 'thumbnail failed');
    }
  });
  return { failed };
}
