/**
 * Deterministic fake collectors for MOCK_MODE. They deliberately produce
 * the messy cases the real pipeline must handle:
 *  - overlapping queries return overlapping videos
 *  - reposts (same picture + caption, new id) every 7th item
 *  - the same Meta ad under several ids (shared collation id) every 5th item
 *  - a mix of strong, weak and unrelated matches
 *  - deeper "pages" (depth) reveal new videos, so repeat searches still fill up
 * Set MOCK_FAIL_SOURCE=instagram|meta to simulate a source outage.
 */
import { sha1, normalizeText } from '../lib/util.js';

const PER_QUERY_PAGE = 12;
const PALETTE = ['#111827', '#f3f4f6', '#1e3a8a', '#4d7c0f', '#d6c7a1', '#7f1d1d', '#db2777', '#0e7490'];

const META_COPY = [
  'Shop the {p} everyone is talking about. Free shipping across India. Limited stock!',
  'Our best-selling {p} is back in stock. Order today, delivered in 3 days.',
  '{p} that actually fits. 7-day easy returns, prepaid orders get 10% off.',
  'Upgrade your wardrobe with the new {p}. Sizes S to 3XL.',
  'Thousands of 5-star reviews. See why everyone loves this {p}.',
];

const rnd = (seed, salt = '') => parseInt(sha1(seed + salt).slice(0, 8), 16) / 0xffffffff;

function thumbSvg(seed) {
  const bg = PALETTE[Math.floor(rnd(seed, 'bg') * PALETTE.length)];
  const fg = PALETTE[Math.floor(rnd(seed, 'fg') * PALETTE.length)];
  const x = Math.round(20 + rnd(seed, 'x') * 60);
  const r = Math.round(18 + rnd(seed, 'r') * 30);
  const shape = rnd(seed, 's') > 0.5
    ? `<circle cx="${x}" cy="90" r="${r}" fill="${fg}"/>`
    : `<rect x="${x - r / 2}" y="${90 - r}" width="${r * 1.2}" height="${r * 2}" rx="6" fill="${fg}"/>`;
  const stripes = Array.from({ length: 3 }, (_, k) => {
    const y = Math.round(rnd(seed, `y${k}`) * 180);
    const w = Math.round(20 + rnd(seed, `w${k}`) * 80);
    return `<rect x="${Math.round(rnd(seed, `sx${k}`) * 60)}" y="${y}" width="${w}" height="${Math.round(6 + rnd(seed, `h${k}`) * 30)}" fill="${PALETTE[Math.floor(rnd(seed, `c${k}`) * PALETTE.length)]}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="192" viewBox="0 0 108 192"><rect width="108" height="192" fill="${bg}"/>${stripes}${shape}<rect x="${Math.round(rnd(seed, 'b') * 70)}" y="150" width="30" height="8" fill="${fg}" opacity=".7"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function similarityFor(seed) {
  const r = rnd(seed, 'sim');
  if (r < 0.45) return Math.round(72 + rnd(seed, 'a') * 26); // strong
  if (r < 0.65) return Math.round(55 + rnd(seed, 'b') * 16); // borderline
  return Math.round(5 + rnd(seed, 'c') * 45);                // weak / unrelated
}

function makeItems(platform, query, depth) {
  const pool = normalizeText(query).split(' ').slice(0, 2).join(' ') || 'x';
  const out = [];
  const total = PER_QUERY_PAGE * (depth + 1);
  for (let n = 0; n < total; n++) {
    let contentSeed = `${platform}|${pool}|${n}`;
    const idSeed = contentSeed;
    if (n % 7 === 6) contentSeed = `${platform}|${pool}|${n - 1}`; // repost of the previous video
    const id = sha1(idSeed).slice(0, 15);
    const sim = similarityFor(contentSeed);
    const tag = pool.replace(/\s/g, '');
    const caption = sim > 55
      ? `Loving this ${pool} 😍 order now, link in bio #${tag} #${tag}india #ootd`
      : `New drop alert! check our store #fashion #trending #${n % 2 ? tag : 'sale'}`;
    out.push({
      platform,
      platformId: platform === 'meta' ? `9${parseInt(id.slice(0, 12), 16)}` : id,
      groupKey: platform === 'meta' ? `meta-col:${sha1(`${pool}|${n - (n % 5 === 4 ? 1 : 0)}`).slice(0, 10)}` : null,
      url: platform === 'meta' ? `https://www.facebook.com/ads/library/?id=mock-${id}` : platform === 'tiktok' ? `https://www.tiktok.com/@mock/video/${id}` : `https://www.instagram.com/reel/mock${id}/`,
      mediaUrl: `https://cdn.example.com/${platform}/${sha1(contentSeed).slice(0, 12)}.mp4`,
      thumbnailUrl: thumbSvg(contentSeed),
      caption: platform === 'meta' ? META_COPY[n % META_COPY.length].replace('{p}', pool) + (n % 3 ? '' : ` Use code SAVE${n}`) : caption,
      author: platform === 'meta' ? `${pool} store ${n % 4}` : `creator_${sha1(idSeed).slice(0, 5)}`,
      publishedAt: new Date(Date.now() - rnd(idSeed, 't') * 60 * 86400_000).toISOString(),
      stats: { views: Math.round(rnd(idSeed, 'v') * 500000), likes: Math.round(rnd(idSeed, 'l') * 20000) },
      query,
      mock: { similarity: sim },
    });
  }
  return out;
}

async function mockCollect(platform, queries, { depth = 0 } = {}) {
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); // feel like a network call
  if ((process.env.MOCK_FAIL_SOURCE || '').split(',').includes(platform)) {
    throw new Error(`Simulated ${platform} outage (MOCK_FAIL_SOURCE)`);
  }
  return queries.flatMap((q) => makeItems(platform, q, depth));
}

export const mockCollectors = {
  instagram: (q, o) => mockCollect('instagram', q, o),
  meta: (q, o) => mockCollect('meta', q, o),
  tiktok: (q, o) => mockCollect('tiktok', q, o),
};
